# SilkFlow AI , Security Self Assessment

Date: 2026-10-14 · Scope: FastAPI backend, React dashboard, Hardhat `SilkEscrow`/`MockStableCoin`,
policy-limited agent, SME copilot. Prepared for the FinTechathon 2026 AI Track optional deliverable.

Every claim below is either (a) enforced in code in this repository, or (b) verified by a test in
`scripts/e2e_test.py` / `contracts/test/SilkEscrow.test.js`. Items that are roadmap-only are marked
as **Limitations**, not presented as done.

## 1. Threat classes assessed (competition rubric)

### 1.1 Induced / unauthorized transfer
- Money can only move through the `SilkEscrow` smart contract; the backend never holds or signs
  with a funded wallet outside escrow operations (local dev-chain accounts only).
- Release requires a verified delivery event bound to the specific order; one release per order is
  enforced on-chain (`released` flag), so replayed release calls revert.
- Disputes freeze funds  no unilateral drain path exists for any role.
- The agent's `funds_escrow` action passes through a deterministic policy gate
  (`api/app/services/policy.py`): kill switch off, amount ≤ `auto_release_limit` (default 25,000),
  dispute-free state, verified documents. A failing check routes the case to the human reviewer
  queue instead of executing.
- Verified live: duplicate escrow funding returns the same transaction (idempotency), and
  over-limit/high-risk cases never auto-release (E2E policy + agent sections).

### 1.2 Information theft
- Authorization is enforced server side, not by UI hiding: every exporter/buyer/reviewer endpoint
  re-checks role and ownership. E2E asserts 403 on cross-business cash-flow, copilot and alerts
  access, buyer-side financing application, and seller side audit reads.
- JWTs are short-lived with refresh rotation and a jti denylist; a revoked token is rejected (E2E).
- Auth endpoints are rate-limited (token bucket, 10/min/IP; 429 verified in E2E).
- Webhook ingestion requires a shared secret (401 on bad secret), enforces event ordering
  (400 out-of-order) and rejects replays (409 duplicate) verified live.
- No secrets are committed: only `.env.example` exists; runtime config is read from environment.
  Demo credentials in `api/app/seed.py` are clearly synthetic local-demo users.

### 1.3 Unauthorized operations
- Role-based access covers every router; reviewer/admin actions (case resolution, kill switch,
  settings, model governance) require the reviewer/admin token.
- All state-changing actions human and agent are appended to a hash chained audit ledger
  (`api/app/services/audit_service.py`). The chain verifier recomputes every entry's hash;
  editing or removing any record turns verification red (demoed live; 199-entry verification
  recorded in `docs/FINAL_REPORT.md`).
- Kill switch blocks all autonomous releases immediately; a per-order cap and mandatory
  human escalation for borderline cases bound agent blast radius.

### 1.4 Prompt injection (LLM-specific)
- Architecture rule: **the LLM never computes and never authorizes.** Financial answers are
  produced by deterministic Python services; the copilot only explains engine output and cites
  figures from it. The LLM has no tool that can move money no wallet, no transfer, no
  order-mutation endpoint is reachable from the model path.
- Copilot calls send a fixed system prompt plus retrieved facts; user text cannot select actions
  because the action layer (agent loop) is policy-gated independently of any model output.
- Deterministic fallback: if the model is unavailable, the copilot answers from the same engine
  results without the LLM, so degradation never widens permissions.
- Demo mode is labelled in the UI and in API responses (`demo mode` badge), so a judge can see
  which outputs come from the language model.
- **Limitation:** adversarial-red-team testing of the copilot was not run at scale; the defense
  is structural (no money tools, policy gate) rather than filter-based.

## 2. Data honesty
- Credit/anomaly models are trained on **synthetic** transaction data (`ml/generate_data.py`,
  seed 7, 5,000 rows; disclosed in UI and deck). Holdout metrics are reported as measured,
  including the case where the simple logistic baseline (0.763 AUC) beats XGBoost (0.725 AUC).
- Financing offers are simulated; logistics/webhook events are mocked (local chain). No real
  counterparties, funds or shipments are represented.
- All on-chain activity is on a local Hardhat dev chain; addresses in `contracts/deployments/latest.json`
  are local deployment artifacts, not mainnet.

## 3. Known limitations (stated, not hidden)
1. Local dev chain only public testnet with independently verifiable tx hashes is roadmap phase 2.
2. No real banking/KYC/logistics integrations document checks use our own cross-check rules on
   uploaded demo files.
3. TLS/infrastructure hardening (HSTS, CSP, WAF) not exercised single-machine demo deployment.
4. Copilot prompt-injection defense is architectural; no third-party red-team certification exists.

## 4. Assessment conclusion
High-risk operations (money movement, releases, overrides) are impossible without either an
on-chain escrow condition being satisfied or a policy-gated agent action passing deterministic
checks, and everything is recorded in a tamper-evident chain. The residual risk we accept for the
demo is credential-theft-equivalent behavior on the local chain, which by design moves only
testnet funds.
