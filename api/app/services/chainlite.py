"""Minimal Ethereum JSON-RPC client for live mode without web3.py.

Python 3.15 has no web3/ckzg wheels, so this module provides the tiny slice
the escrow bridge needs: plain JSON-RPC over httpx, ABI calldata encoding
(eth_abi + keccak selector), address derivation from a private key (ecdsa +
keccak), and transaction submission via eth_sendTransaction. That last one
relies on the LOCAL Hardhat node keeping its well-known accounts unlocked —
never point this at a network holding real funds.
"""
import time

import httpx
from eth_abi import encode as abi_encode
from eth_utils import encode_hex, keccak


def addr_from_pk(pk_hex: str) -> str:
    from ecdsa import SECP256k1, SigningKey
    secret = bytes.fromhex(pk_hex.removeprefix("0x"))
    sk = SigningKey.from_string(secret, curve=SECP256k1)
    pt = sk.verifying_key.pubkey.point
    pub = pt.x().to_bytes(32, "big") + pt.y().to_bytes(32, "big")
    return to_checksum("0x" + keccak(pub).hex()[-40:])


def to_checksum(addr: str) -> str:
    """EIP-55 checksum address."""
    body = addr.lower().removeprefix("0x")
    hs = keccak(body.encode()).hex()
    return "0x" + "".join(c.upper() if hs[i] in "89abcdef" else c for i, c in enumerate(body))


def calldata(sig: str, types: list[str], args: list) -> str:
    selector = keccak(text=sig)[:4]
    return encode_hex(selector + abi_encode(types, args))


class Rpc:
    def __init__(self, url: str, timeout: float = 6.0):
        self.url = url
        self.timeout = timeout
        self._id = 0

    def call(self, method: str, params: list | None = None):
        self._id += 1
        payload = {"jsonrpc": "2.0", "id": self._id, "method": method,
                   "params": params or []}
        r = httpx.post(self.url, json=payload, timeout=self.timeout)
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            raise RuntimeError(j["error"].get("message", str(j["error"])))
        return j["result"]

    def ok(self) -> bool:
        try:
            return self.call("eth_chainId") is not None
        except Exception:
            return False

    def chain_id(self) -> int:
        return int(self.call("eth_chainId"), 16)

    def get_code(self, addr: str) -> str:
        return self.call("eth_getCode", [addr, "latest"])

    def nonce(self, addr: str) -> int:
        return int(self.call("eth_getTransactionCount", [addr, "latest"]), 16)

    def gas_price(self) -> int:
        return int(self.call("eth_gasPrice"), 16)

    def send(self, from_addr: str, to: str, data: str, value: int = 0) -> str:
        tx = {"from": to_checksum(from_addr), "to": to_checksum(to), "data": data}
        if value:
            tx["value"] = hex(value)
        return self.call("eth_sendTransaction", [tx])

    def wait_receipt(self, tx_hash: str, timeout: float = 25.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            rec = self.call("eth_getTransactionReceipt", [tx_hash])
            if rec:
                if rec.get("status") == "0x0":
                    raise RuntimeError(f"tx reverted: {tx_hash}")
                return rec
            time.sleep(0.25)
        raise TimeoutError(f"no receipt for {tx_hash}")

    def send_and_wait(self, from_addr: str, to: str, data: str) -> str:
        h = self.send(from_addr, to, data)
        self.wait_receipt(h)
        return h
