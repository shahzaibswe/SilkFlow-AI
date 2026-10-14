"""Escrow chain service: web3 live mode with simulated-chain fallback.

Contract (per API_SPEC §1): reads `silkflow/contracts/deployments/latest.json`.
If the file is missing OR the RPC is unreachable at startup, the backend runs
in **simulated** mode forever (deterministic sha256 fake tx hashes prefixed
0x, escrow state mirrored into the `escrows` DB table) so the demo never
breaks.

Orders are keyed on-chain by bytes32 orderId = keccak256(ascii(str(order_id))).

Exposed API (all take an active SQLAlchemy Session):
    status() -> {"mode","escrow_address","token_address"}
    create_escrow(db, order) -> {"tx_hash", "state", ...}
    fund_escrow(db, order, tx_hash=None)
    confirm_shipment(db, order)
    release(db, order)
    dispute(db, order)
    resolve(db, order, decision)   # decision: "release" | "refund"
"""
import hashlib
import json
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import DEPLOYMENT_FILE
from ..models import Escrow, Order
from .. import chain_accounts

log = logging.getLogger("silkflow.chain")

_state: dict = {"mode": "simulated", "escrow_address": "", "token_address": "",
                "deployment": None, "lite": None, "accounts": [],
                "agent_address": "", "reviewer_address": "", "rpc_url": ""}


def _load_deployment() -> dict | None:
    p = Path(DEPLOYMENT_FILE)
    if not p.exists():
        log.info("deployment file missing (%s) -> simulated chain mode", p)
        return None
    try:
        return json.loads(p.read_text())
    except Exception as exc:
        log.warning("deployment file unreadable (%s) -> simulated chain mode", exc)
        return None


def init() -> None:
    """Decide live vs simulated once at startup.

    Live mode uses web3.py when importable; otherwise the built-in lightweight
    JSON-RPC client (services/chainlite.py, eth_sendTransaction against an
    unlocked local Hardhat node). No deployment file or unreachable RPC =>
    simulated.
    """
    dep = _load_deployment()
    if dep is None:
        _state["mode"] = "simulated"
        return
    rpc = dep.get("rpcUrl", "http://127.0.0.1:8545")
    try:
        from . import chainlite
        client = chainlite.Rpc(rpc)
        if not client.ok():
            raise ConnectionError("RPC not reachable")
        escrow = dep["escrowAddress"]
        if not client.get_code(escrow) or client.get_code(escrow) == "0x":
            raise ConnectionError("no contract code at escrow address " + escrow)
        accounts = [chainlite.to_checksum(a) for a in client.call("eth_accounts")]
        if not accounts:
            raise ConnectionError("node returned no unlocked accounts")
        _state.update(
            mode="live", lite=client, deployment=dep, rpc_url=rpc, accounts=accounts,
            escrow_address=chainlite.to_checksum(escrow),
            token_address=chainlite.to_checksum(dep["tokenAddress"]),
            reviewer_address=chainlite.to_checksum(dep.get("reviewerAddress", "")),
            agent_address=chainlite.to_checksum(dep.get("agentAddress", "")),
        )
        log.info("chain mode LIVE (lite rpc) at %s escrow=%s accounts=%d",
                 rpc, escrow, len(accounts))
    except Exception as exc:
        log.info("RPC %s unusable (%s) -> simulated chain mode", rpc, exc)
        _state.update(mode="simulated", deployment=dep, rpc_url=rpc,
                      escrow_address=dep.get("escrowAddress", ""),
                      token_address=dep.get("tokenAddress", ""))


def status() -> dict:
    return {"mode": _state["mode"], "escrow_address": _state["escrow_address"],
            "token_address": _state["token_address"]}


def node_accounts() -> list[str]:
    """Real unlocked node addresses (live mode), empty when simulated."""
    return _state["accounts"]


def order_key(order_id: int) -> bytes:
    """bytes32 orderId = keccak256(ascii(str(order_id)))."""
    try:
        from eth_utils import keccak
        return keccak(text=str(order_id))
    except ImportError:
        from web3 import Web3
        return bytes(Web3.keccak(text=str(order_id)))


def _sim_hash(action: str, order_id: int, seq: int) -> str:
    """Deterministic fake tx hash: same order+action always yields the same hash."""
    return "0x" + hashlib.sha256(f"simtx|{action}|{order_id}|{seq}".encode()).hexdigest()


def escrow_row(db: Session, order: Order) -> Escrow:
    row = db.query(Escrow).filter(Escrow.order_id == order.id).one_or_none()
    if row is None:
        row = Escrow(order_id=order.id, amount=order.amount, token="sUSD",
                     contract_address=_state["escrow_address"] or "0x" + "00" * 20,
                     buyer_wallet=_wallet(db, order.buyer_id),
                     seller_wallet=_wallet(db, order.seller_id), state="None")
        db.add(row)
        db.flush()
    return row


def _wallet(db: Session, business_id: int) -> str:
    from ..models import Business
    b = db.get(Business, business_id)
    if b is None:
        return ""
    if not b.wallet_address:
        b.wallet_address = chain_accounts.address_for_business(
            b, _state["mode"], _state["accounts"])
    return b.wallet_address


def _submit(order_fn_args, sig: str, types: list[str], from_addr: str,
            to: str | None = None) -> str:
    """Encode + send a contract call through the lite RPC client; returns tx hash."""
    from . import chainlite
    lite = _state["lite"]
    data = chainlite.calldata(sig, types, order_fn_args)
    return lite.send_and_wait(from_addr, to or _state["escrow_address"], data)


def _key(order: Order) -> bytes:
    return order_key(order.id)


# --- public operations ---------------------------------------------------------
def create_escrow(db: Session, order: Order) -> dict:
    row = escrow_row(db, order)
    if row.state != "None":
        return _to_dict(row, tx_hash=row.tx_create)
    if _state["mode"] == "live":
        tx = _submit([_key(order), int(order.amount * 1_000_000),
                      row.buyer_wallet, row.seller_wallet],
                     "createOrder(bytes32,uint256,address,address)",
                     ["bytes32", "uint256", "address", "address"],
                     _state["agent_address"])
    else:
        tx = _sim_hash("create", order.id, 1)
    row.state = "Created"
    row.tx_create = tx
    db.flush()
    return _to_dict(row, tx_hash=tx)


def fund_escrow(db: Session, order: Order, tx_hash: str | None = None) -> dict:
    row = escrow_row(db, order)
    if row.state == "None":
        create_escrow(db, order)
    if row.state in ("Funded", "ShipmentConfirmed", "Released"):
        return _to_dict(row)
    if tx_hash:
        row.tx_fund = tx_hash
    elif _state["mode"] == "live":
        from . import chainlite
        amount = int(order.amount * 1_000_000)
        lite = _state["lite"]
        # pull-then-push: buyer approves the token allowance, then calls fund()
        appr = chainlite.calldata("approve(address,uint256)", ["address", "uint256"],
                                  [_state["escrow_address"], amount])
        lite.send_and_wait(row.buyer_wallet, _state["token_address"], appr)
        row.tx_fund = _submit([_key(order)], "fund(bytes32)", ["bytes32"], row.buyer_wallet)
    else:
        row.tx_fund = _sim_hash("fund", order.id, 2)
    row.state = "Funded"
    db.flush()
    return _to_dict(row)


def confirm_shipment(db: Session, order: Order) -> dict:
    row = escrow_row(db, order)
    if row.state == "Funded":
        if _state["mode"] == "live":
            row.tx_confirm = _submit([_key(order)], "confirmShipment(bytes32)",
                                     ["bytes32"], _state["agent_address"])
        else:
            row.tx_confirm = _sim_hash("confirm", order.id, 3)
        row.state = "ShipmentConfirmed"
        db.flush()
    return _to_dict(row)


def release(db: Session, order: Order) -> dict:
    row = escrow_row(db, order)
    if _state["mode"] == "live":
        row.tx_release = _submit([_key(order)], "release(bytes32)", ["bytes32"],
                                 _state["agent_address"])
    else:
        row.tx_release = _sim_hash("release", order.id, 4)
    row.state = "Released"
    db.flush()
    return _to_dict(row)


def dispute(db: Session, order: Order) -> dict:
    row = escrow_row(db, order)
    if _state["mode"] == "live":
        # demo: raised from the buyer wallet (a registered party on-chain)
        row.tx_dispute = _submit([_key(order)], "raiseDispute(bytes32)", ["bytes32"],
                                 row.buyer_wallet)
    else:
        row.tx_dispute = _sim_hash("dispute", order.id, 5)
    row.state = "Disputed"
    db.flush()
    return _to_dict(row)


def resolve(db: Session, order: Order, decision: str) -> dict:
    """decision 'release' -> 0 (pay seller), 'refund' -> 1 (pay buyer)."""
    row = escrow_row(db, order)
    code = 0 if decision == "release" else 1
    if _state["mode"] == "live":
        row.tx_resolve = _submit([_key(order), code], "resolve(bytes32,uint8)",
                                 ["bytes32", "uint8"], _state["reviewer_address"])
    else:
        row.tx_resolve = _sim_hash(f"resolve_{decision}", order.id, 6)
    row.state = "Released" if decision == "release" else "Refunded"
    if decision == "release":
        row.tx_release = row.tx_release or row.tx_resolve
    db.flush()
    return _to_dict(row)


def _to_dict(row: Escrow, tx_hash: str | None = None) -> dict:
    h = row.tx_release or row.tx_fund or row.tx_create or tx_hash or ""
    return {
        "contract_address": row.contract_address, "amount": row.amount, "token": row.token,
        "state": row.state, "buyer_wallet": row.buyer_wallet, "seller_wallet": row.seller_wallet,
        "tx_fund": row.tx_fund, "tx_release": row.tx_release,
        "tx_create": row.tx_create, "tx_confirm": row.tx_confirm,
        "tx_dispute": row.tx_dispute, "tx_resolve": row.tx_resolve,
        "explorer_url": (f"sim://tx/{h}" if _state["mode"] == "simulated"
                         else f"{_state['rpc_url']}/tx/{h}") if h else None,
    }
