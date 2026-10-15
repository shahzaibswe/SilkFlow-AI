# SilkFlow AI Final Technical, Functional, Security, AI Model & API Audit Report

Date: 2026-10-12 · Build: FastAPI + React + Hardhat local chain + real XGBoost/SHAP/IsolationForest
Stack state at time of writing: chain **live**, API healthy (`audit_valid: true`), UI built (0 errors),
full E2E **65/65 passing** against the running live-chain stack.

This report distinguishes strictly between (A) spec requirements, (B) implemented code,
(C) successfully tested behavior, and (D) external integrations blocked by credentials/network.

---

## A. Executive summary

All three v2 business requirements are implemented and tested end to end:

1. **Financial analysis & explainable trade-risk assessment** , XGBoost credit scorer with SHAP
   explanations, Isolation-Forest anomaly detection, logistic-regression baseline, risk bands,
   suggested terms, FX exposure notes.
2. **Cash-flow forecasting, alerts & financing recommendations** , deterministic weekly forecaster
   (opening balance + scheduled receipts − payments), negative-balance gap alerts, what-if delay
   scenarios that never mutate persisted state, three ranked simulated financing offers per scored
   order with idempotent application.
3. **Policy-limited AI agent** , observe → decide → policy-check → act → audit loop; kill switch,
   auto-release limit, dispute freeze, one-release-per-order; money movement only through the
   escrow smart contract after explicit policy checks. The LLM never authorizes or computes money.

## B. Feature coverage vs v2 specification

| Requirement | Status | Evidence |
|---|---|---|
| 16-step business workflow (onboarding→settlement→dispute→audit) | Implemented & tested | E2E sections 1–3, live browser walkthrough |
| Exporter portal (dashboard, orders, docs, score, cash-flow, copilot, financing) | Implemented | `/orders`, `/cash-flow`, `/copilot`, financing cards on order detail |
| Buyer portal (inbox, terms, fund escrow, disputes) | Implemented | E2E buyer flow; live tx hashes recorded |
| Reviewer/Admin console (feed, queue, resolve, audit, kill switch, settings) | Implemented | E2E policy + audit sections |
| Backend RBAC enforced server-side | Implemented | 403s verified in E2E (cross-business cashflow/copilot/alerts, buyer apply, seller audit) |
| Short-lived access + refresh tokens, revocation | Implemented | jti denylist; revoked token rejected (E2E) |
| Auth rate limiting | Implemented | token bucket 10/min/IP; 429 verified (E2E) |
| Pagination (orders, audit, alerts) | Implemented | `total/limit/offset` verified (E2E) |
| Idempotency (escrow create/fund, financing apply, alerts) | Implemented | duplicate fund → same tx; re-apply → same offer id; alert de-dupe (verified live) |
| Webhook auth, ordering, replay rejection | Implemented | 401 bad secret, 400 out-of-order, 409 duplicate (verified live) |
| Audit hash chain + integrity verify + tamper demo | Implemented | verify→tamper→detect→restore cycle (E2E) |
| Cash-flow: normal / delayed / negative / missing-data / multi-receipt | Implemented | gap demo (Bilal −$5,400), scenario +2 gap weeks, receipts-only default; E2E cashflow block |
| Financing matcher deterministic, ranked, labelled simulated | Implemented | annualised-cost ranking; "SIMULATED · PROTOTYPE" badge + disclaimer in UI and API |
| Copilot grounded, cites figures, refuses fabrication, role-scoped | Implemented | mode badge `deterministic-demo`, cited-figure chips, 403 cross-scope (E2E) |
| PostgreSQL target / SQLite local | SQLite local (documented); SQLAlchemy ORM portable; Postgres not exercised | see §G |
| Migrations | Not implemented (fresh `create_all` + reseed is the demo workflow) | see §J |

## C. AI model configuration report (§7G — exact facts)

Runtime: Python 3.15.0 · xgboost 3.4.1 · scikit-learn 1.9.1 · shap 0.53.0 · numpy 2.5.4 · pandas 3.0.6.
All models run **locally** (no external inference API).

**Credit scorer (main candidate)** , XGBoost `XGBClassifier`: 250 trees, max_depth 4, lr 0.08,
subsample 0.9, colsample_bytree 0.9, reg_lambda 1.0, seed 42. Local, artifact
`ml/artifacts/model_artifacts.pkl` (joblib), version `v1.3-synth` (+`.rN` per retrain; active is `v1.3-synth.r1`).
**Logistic Regression baseline** , sklearn `LogisticRegression(max_iter=2000, C=1.0)`, trained on the
identical seeded 80/20 split (seed 7), always reported side by side.
**Holdout (1,000 rows, synthetic):** XGBoost AUC 0.725 · acc 0.775 · precision 0.810 · recall 0.921 ·
F1 0.862 · CM TP 703 / FP 165 / FN 60 / TN 72. LR baseline AUC 0.763 · acc 0.790 · F1 0.873.
**Honest finding: the simple baseline beats the boosted model on this synthetic signal.** This is
surfaced in the UI ("reported honestly, not curated") and in `GET /api/models` metrics.
**Explanations** , SHAP `TreeExplainer` mean|SHAP per feature, verified to accompany every score;
direction/top-5 identical to the perturbation fallback used when shap is absent.
**Anomaly detector** , sklearn `IsolationForest(n_estimators=200, contamination=0.025, random_state=42)`
on the 8-feature canonical vector; output is a *warning that routes to human review*, never a fraud verdict.
**Feature schema (8):** past_orders, on_time_rate, buyer_avg_days_to_pay, buyer_country_risk,
invoice_to_avg_ratio, doc_discrepancy_count, payment_term_days, fx_volatility (+ goods-category one-hots).
Missing values fall back to corridor medians; no target leakage (target is only `trade_completed_on_time`).
**Data** , 100% synthetic (`ml/generate_data.py`), labelled everywhere (API `synthetic: true`, UI, docs).
Not validated banking-grade prediction; pilot retrain plan in `docs/DATA_MODEL.md` §4.

**LLM (document checker + copilot narrator)** , integration implemented for the OpenAI Chat
Completions API (`https://api.openai.com/v1/chat/completions`, model `OPENAI_MODEL` default
`gpt-4o-mini`, temperature 0.2, max_tokens 300, timeout 20 s, structured-JSON prompt for the
checker with schema validation of the reply). **`OPENAI_API_KEY` is NOT set in this environment,
so the LLM path could not be exercised live.** Every LLM-dependent response is explicitly labelled
(`mode: "deterministic-demo"`, badge "DETERMINISTIC DEMO" in UI; `checker: "rules"` for documents).
No fabricated LLM output is presented anywhere. Fallback is deterministic, disclosed, and tested.

## D. External integration record (§8E)

| Provider | Endpoint / SDK | Auth | Status | Honest labeling |
|---|---|---|---|---|
| Frankfurter (FX) | `https://api.frankfurter.dev/v1/latest` + time series, no key | — | **Verified live**: USD→EUR 0.89238, USD→INR 96.73 return `source:"live"`; volatility computed from 30-day window | PKR is **not offered by the provider** → `source:"cache"|"synthetic"` with UI "Source: Synthetic" chip. Never called live market data |
| Blockchain | **Local Hardhat node** `http://127.0.0.1:8545` (chainId 31337), custom JSON-RPC client (`chainlite.py`, httpx) because web3/eth-account lack Python 3.15 wheels; Solidity 0.8.x via Hardhat; contracts `SilkEscrow` + `MockStableCoin (sUSD)` deployed via `scripts/deploy.js` | 20 unlocked node accounts — **no private keys anywhere**; agent/reviewer/buyers/exporters mapped to node accounts in `chain_accounts.py` | **Live**: escrow create/fund/confirm/release/dispute/resolve all produce real tx hashes; DB states cross-checked against contract `getState()` and receipts | Mock sUSD token clearly labelled; test/local-chain funds only |
| Sepolia testnet | — | needs RPC key + funded test ETH | **Blocked: no credentials/funds in this environment.** Local Hardhat chosen instead (explicitly permitted by spec §8C) | disclosed here |
| OpenAI LLM | see §C | `OPENAI_API_KEY` env | **Blocked: key not present** → deterministic fallbacks active and labelled | mode badges |
| Logistics | `POST /api/webhooks/logistics`, header `X-Webhook-Secret` | shared secret (env) | **Mock by design** — every alert says "mock carrier feed" | never presented as a real carrier |

## E. Test evidence (what actually passed)

- `python scripts/e2e_test.py` → **65 passed / 0 failed** against the live-chain stack (twice: once
  mid-session, once on the final clean wipe→redeploy→reseed cycle). Covers: auth+RBAC (403 paths),
  bad-password 401, refresh/logout/revocation, full settlement with real on-chain release, kill-switch
  hold, dispute freeze + reviewer refund (escrow Refunded), audit verify→tamper→detect→restore,
  retrain, FX, cashflow gap demo, scenario non-persistence, 3 ranked offers, idempotent apply,
  cash_gap alert de-dupe, copilot grounding+scope, orders/audit pagination, LR baseline metrics,
  auth rate-limit 429.
- `npx hardhat test` → **38 passing** (escrow state machine, double-release prevention, reviewer-only
  resolve, dispute finality, independence of orders).
- `python -m ml.tests.test_service` → all green (scoring bounds, anomaly positive/negative cases,
  explanation sanity, degradation on bad input, retrain contract).
- Negative-path API probes: 422 (delay>180, delay<0, question<3 chars), 404 (unknown offer), 409
  (duplicate webhook event), 400 (out-of-order event), 401 (bad webhook secret), 403 (cross-business
  ×3), 429 (auth flood) — all observed live.
- UI: production build ✓ (0 errors); browser walkthrough of all three portals via accessibility
  snapshots (login → reviewer feed + alert bell dropdown → exporter cash-flow + live what-if run →
  copilot Q&A → order financing cards → buyer inbox → models evaluation panel).

## F. Security review

Enforced in backend, not UI: role guards on every route; party checks on orders; business-ownership
guards on cashflow/alerts/copilot. JWT short-lived access + refresh with jti denylist on logout.
PBKDF2 password hashing. Rate-limited auth. Webhook secret + ordering + replay rejection.
No secrets/keys/passwords in logs (request logger records method/path/status only); no private keys
in code or config (unlocked-account design). LLM output cannot move money: releases require the
deterministic policy engine (kill switch, limit, evidence, dispute, single-release checks) —
the LLM is narrator-only. Financing/cash figures are computed only in deterministic Python.
Input validation via typed Pydantic schemas on every write endpoint.

## G. Known limitations & blocked items (exact blockers)

1. **No OpenAI key in this environment** → document checker runs rule-based; copilot runs
   deterministic templates (both labelled). Setting `OPENAI_API_KEY` in `.env` activates the LLM path.
2. **Frankfurter has no PKR** → demo corridor USD/PKR uses cached/synthetic rates, labelled as such.
3. **Local Hardhat chain, not Sepolia** , deploying to Sepolia needs a paid/free RPC key and testnet
   ETH, neither available here. Contract code and client are network-agnostic (config swap only).
4. **SQLite**, per spec's allowance for local development; PostgreSQL was not exercised.
5. **No Alembic migrations** , schema changes are applied by wiping `api/silkflow.db` + redeploying
   contracts (order keys are per-contract) and auto-reseeding.
6. **Offers/financing are simulated**; no real lender integration; no email/SMS notifications
   (in-app alert table only).
7. Browser **screenshots** were intermittently blocked by the hidden in-app viewport; structural
   verification used accessibility snapshots instead.

## H. Demo quick reference

`./run.sh` / `run.ps1` or manual: hardhat node → deploy → uvicorn :8000 → vite :5173.
Accounts (password `Password123!`): seller / seller2 (cash-gap demo) / buyer / buyer2 / reviewer / admin.
Five-scenario walkthrough in `README.md` (settlement, mismatch hold, tamper check, cash-flow copilot,
simulated financing).

## I. Data model

19 tables (15 spec + settings + cashflow_items, cashflow_forecasts, financing_offers, alerts),
`businesses.opening_balance`; verified present after fresh seed. Audit chain:
`entry_hash = sha256(previous ‖ order ‖ data_hash ‖ timestamp)`, genesis zeros, `verify` walks the
full chain; every material action (agent, settlement, dispute, alert, copilot ask, financing request,
KYB, retrain) appends an entry.

## J. Recommended next steps for productionization

Alembic migrations + PostgreSQL run; real KYB/document provider; funded Sepolia (or L2 testnet)
deployment with a managed signer (KMS) instead of unlocked accounts; real carrier webhooks with HMAC
signatures; OpenAI key + expanded checker eval set; time-series model validation on real loss data;
idempotency keys on client retries (currently state-machine guards); structured audit-log shipping.

## K. Truthfulness statement

Every number, hash, metric, and status in this report comes from code executed in this environment
during this session (E2E 65/65, Hardhat 38/38, ML suite, live browser snapshots, live RPC receipts).
No API response, transaction, credential, or model result has been invented. Anything not actually
connected (OpenAI, Sepolia, real carriers, Postgres) is listed as blocked or simulated in §G, and the
running UI labels the same items as demo/synthetic/simulated on screen.
