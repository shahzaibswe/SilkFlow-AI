# SilkFlow AI , Execution Evidence

Date: 2026-10-14. Every result below was produced by commands anyone can re-run from this
repository. The headline run was recorded on 2026-10-12 against the live local-chain stack and
reproduced in `docs/FINAL_REPORT.md` (section E).

## 1. How to reproduce

```powershell
# Easiest path (Windows): starts chain + deploy + trains models + API + dashboard
.\run.ps1
# The API auto-seeds demo data on first run (users, businesses, 6 orders; DEMO_PASSWORD in api/app/seed.py)
```

```bash
# Manual path
cd contracts && npm install && npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
cd ../api && pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000        # auto-seeds on first run

# Evidence suites
npx hardhat test                                  # contracts
cd .. && python scripts/e2e_test.py               # end-to-end against live stack (API on :8000)
cd ml && pip install -r requirements.txt
python -m pytest tests/                           # ML suite
```

## 2. Recorded results

| Evidence | Result | Where to see it |
|---|---|---|
| End-to-end suite vs live chain + API | **65 passed / 0 failed** | `python scripts/e2e_test.py` prints each check; run recorded in `docs/FINAL_REPORT.md` §E |
| Smart-contract suite (fund/release/dispute/replay/one-release) | **38 passed / 0 failed** | `npx hardhat test` in `contracts/` |
| ML holdout metrics (1,000 rows, seed 7, fixed split) | XGBoost AUC 0.725 · logistic baseline AUC **0.763** (baseline wins reported as measured) | `ml/artifacts/model_meta.json`, `docs/FINAL_REPORT.md` §D |
| Audit hash chain | 199 entries, verifier `audit_valid: true`; tamper demo turns it red | Reviewer → Audit trail page; screenshots `docs/screenshots/13_audit_verified.png` |
| On-chain deployment | `SilkEscrow 0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82`, `MockStableCoin 0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` **local Hardhat dev chain** | `contracts/deployments/latest.json` |
| Live tx hashes from E2E run | Recorded with each escrow event in the audit ledger | Order detail / audit pages; hashes surfaced via `HashLink` component |
| UI walkthrough (all three portals) | Screenshot set 01–15 + narrated demo video | `docs/screenshots/`, `docs/SilkFlow_Walkthrough_Voice.mp4` (4:56) |

## 3. What each suite proves

- **E2E (65 checks)** role-scoped auth (403 cross-access), token revocation, rate limiting
  (429), pagination, document cross-check, scoring + SHAP reasons, escrow fund → delivery →
  release flow with idempotent duplicate handling, dispute freeze, policy escalation to human
  queue, kill switch, webhook auth/ordering/replay rejection, audit chain verification.
- **Hardhat (38 tests)** contract-level invariants: funds locked in contract, release only on
  verified delivery for the bound order, one release per order, dispute path, revert conditions.
- **ML suite** deterministic scorer parity, anomaly screen config (Isolation Forest
  contamination 0.025), metric reproducibility from `model_meta.json`.

## 4. Honesty notes
- Synthetic data, simulated financing offers and mock logistics events are labelled in the UI and
  in `docs/FINAL_REPORT.md`; nothing here claims real funds, real counterparties or mainnet
  transactions.
- If a re-run environment lacks Node/Python dependencies, the exact blocker is reproducible from
  the commands above we state blockers rather than substituting numbers.
