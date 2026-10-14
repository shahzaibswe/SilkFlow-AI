"""Business <-> on-chain wallet mapping.

Simulated mode: every business gets a deterministic, valid-shaped 20-byte
address derived from sha256 of its legal name + id (stable across restarts).

Live mode: the local Hardhat node keeps its well-known accounts unlocked and
we send via eth_sendTransaction, so NO private keys are needed or stored.
The real addresses come from eth_accounts at startup: buyers map to accounts
#4..#7 (the ones deploy.js minted 1M sUSD to), exporters (CN corridor) to
#8/#9. Mapping is by business id and wraps around if the pool is smaller.
"""
import hashlib

BUYER_SLOTS = (4, 8)
EXPORTER_SLOTS = (8, 10)


def deterministic_address(seed: str) -> str:
    return "0x" + hashlib.sha256(seed.encode()).hexdigest()[:40]


def address_for_business(business, mode: str, node_accounts: list[str] | None = None) -> str:
    """Return the wallet address a business should use."""
    if mode == "live" and node_accounts:
        lo, hi = EXPORTER_SLOTS if business.country == "CN" else BUYER_SLOTS
        pool = node_accounts[lo:hi] or node_accounts
        return pool[business.id % len(pool)]
    return deterministic_address(f"{business.legal_name}:{business.id}")
