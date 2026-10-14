# SilkFlow AI

SME finance copilot for cross-border trade: explainable credit scoring, weekly cash-flow
forecasting with negative-balance alerts, ranked simulated financing options, a grounded
financial copilot, on-chain escrow (live local chain/testnet with simulated fallback),
policy-limited autonomous settlement, and a full audit hash chain. Built for the 2026
Shenzhen International Fintech Competition (FinTechathon), International Track —
Topic E: SME Finance Copilot.

## FinTechathon 2026 submission deliverables

| Deliverable | Where |
|---|---|
| Source code | This repository: `contracts/`, `api/`, `ml/`, `dashboard/`, `scripts/` |
| Technical documentation | `docs/FINAL_REPORT.md`, `docs/API_SPEC.md`, `docs/DATA_MODEL.md` |
| Security self-assessment report | `docs/SECURITY_SELF_ASSESSMENT.md` |
| Execution evidence | `docs/EXECUTION_EVIDENCE.md` (repro commands + recorded 65/65 E2E, 38/38 contract tests, audit chain, honest holdout metrics) |
| Defense deck (≤10 min) | `docs/SilkFlow_FinTechathon_Defense.pptx` |
| Demo video (≤5 min) | `docs/SilkFlow_Walkthrough_Voice.mp4` (4:56, narrated, role-by-role) |

## Repo layout

| Folder       | What lives there |
|--------------|------------------|
| `contracts/` | Solidity `SilkEscrow` + `MockStableCoin`, Hardhat tests, deploy script → `deployments/latest.json` |
| `ml/`        | Synthetic trade data, credit scorer (XGBoost/logistic + SHAP or fallback), Isolation Forest anomalies, `ml.service` API |
| `api/`       | FastAPI backend: auth/RBAC + rate limiting, orders, documents, scoring bridge, cash-flow forecaster, financing matcher, alerts, grounded copilot, escrow bridge (live chain or simulated), agent orchestrator + policy engine, FX risk, disputes, audit hash chain, mock logistics webhook |
| `dashboard/` | React + Tailwind + Chart.js — Exporter Portal (incl. Cash Flow + Copilot pages), Buyer Portal, Reviewer/Admin Console |
| `docs/`      | API_SPEC (build contract), DATA_MODEL assumptions, pitch notes |

## Quickstart (local demo)

```bash
cp .env.example .env

# 1. Smart contract (optional — backend auto-falls back to simulated chain)
cd contracts && npm install && npx hardhat node      # terminal A
npx hardhat run scripts/deploy.js --network localhost  # terminal B

# 2. ML models (auto-trains on first use if skipped)
cd ml && pip install -r requirements.txt
python -m ml.generate_data && python -m ml.train

# 3. Backend  (http://127.0.0.1:8000/docs)
cd api && pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload

# 4. Dashboard  (http://127.0.0.1:5173)
cd dashboard && npm install && npm run dev
```

Or use the one-command script: `./run.sh` (or `run.ps1` on Windows PowerShell).

## Demo accounts (password for all: `Password123!`)

- Exporter: `seller@coretech.io` — second exporter `seller2@coretech.io` (deliberately
  low opening balance → live cash-gap alert demo) — Buyer: `buyer@globalmart.pk`
- Reviewer: `reviewer@coretech.io` — Admin: `admin@coretech.io`

## Demo script (5 scenarios)

1. **Clean settlement**: new order → upload docs → auto check + score → buyer funds escrow →
   Simulate Shipment → agent releases funds on-chain → audit entry with tx hash.
2. **Mismatch hold**: order with inconsistent packing list → checker flags discrepancies →
   agent holds/escalates instead of releasing → reviewer resolves in Console.
3. **Tamper check**: Audit Trail → Verify Integrity (green) → admin tampers one entry →
   verify again (red broken link highlighted).
4. **Cash-flow copilot**: log in as `seller2@coretech.io` → Cash Flow page shows negative
   projected weeks (red) + cash_gap alert → what-if: delay the disputed order's payment
   30 days → chart overlay + delta; ask the Copilot "why is my balance negative?".
5. **Simulated financing**: scored order → ranked financing cards (clearly labelled
   simulated) → Apply (idempotent) → funding alert; offers never move money.

## Tests

`python scripts/e2e_test.py` — 65 assertions covering auth/RBAC, rate limiting, full
settlement on the live local chain, policy holds, disputes, audit tamper detection,
pagination, idempotent financing apply, cash-gap forecasting, scenarios, copilot scoping,
and ML metrics incl. the logistic-regression baseline. Contracts: `cd contracts && npx hardhat test`. ML: `cd ml && python -m ml.tests.test_service`.

## Honesty notes

Testnet/simulated funds only; synthetic, clearly-labeled training data; mock logistics. See
`docs/DATA_MODEL.md` and the scope-boundaries section of the handoff document.
