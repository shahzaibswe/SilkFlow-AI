# SilkFlow AI — contracts

Hardhat (JS) project for the SilkFlow blockchain subsystem: `MockStableCoin`
(sUSD, 6 decimals, open faucet) + `SilkEscrow` (6-state trade-finance escrow
with agent/reviewer roles), per `../docs/API_SPEC.md` §1.

## Quickstart

```bash
npm install                                   # one-time
npx hardhat test                              # run the SilkEscrow test suite
npx hardhat node                              # terminal 1: local chain on :8545
npx hardhat run scripts/deploy.js --network localhost   # terminal 2: deploy + write deployments/latest.json
```

`scripts/deploy.js` sets agent = Hardhat account #2, reviewer = #3, mints
1,000,000 sUSD each to accounts #4–#7, and writes `deployments/latest.json`
(addresses, well-known Hardhat private keys — local testnet only — and full
ABIs) for the FastAPI backend to consume.

## Env (optional)

- `PRIVATE_KEYS="0x…,0x…"` or `MNEMONIC=…` to override `localhost` signing accounts in `hardhat.config.js`.
