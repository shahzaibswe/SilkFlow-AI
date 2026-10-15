# SilkFlow AI Shared Build Contract (API_SPEC)

This file is the single source of truth for interfaces between the four subsystems:
`contracts/` (Hardhat), `ml/` (models + service), `api/` (FastAPI backend), `dashboard/` (React).
Builders MUST follow these shapes exactly.

## Runtime topology (local dev, Windows)

| Service        | URL                                       | Started by |
|----------------|-------------------------------------------|------------|
| Hardhat node   | `http://127.0.0.1:8545`                   | `contracts/` : `npx hardhat node` |
| Backend API    | `http://127.0.0.1:8000` (docs at `/docs`) | `api/` : `uvicorn app.main:app` |
| Dashboard dev  | `http://127.0.0.1:5173`                   | `dashboard/` : `npm run dev` (Vite proxies `/api` → 8000) |

Env config lives at repo root `.env` (copy `.env.example`). Backend loads it from repo root or its own dir.

## 1. Contracts (`silkflow/contracts/`)

Hardhat project (JS, `@nomicfoundation/hardhat-toolbox`), Solidity ^0.8.24.

### `contracts/MockStableCoin.sol`
ERC-20, 6 decimals, name "Silk USD", symbol "sUSD". Public faucet `mint(address to, uint256 amount)` (open in demo).

### `contracts/SilkEscrow.sol`
Roles: `agent` (the AI agent wallet), `reviewer` (backend/reviewer admin address), owner = deployer.
Buyers are external EOAs identified on-chain by the escrow slot, not registered.

Orders are keyed by `bytes32 orderId` (backend passes `keccak256(ascii(str(order_id)))`).

State machine (enum EscrowState): `Created, Funded, ShipmentConfirmed, Released, Disputed, Refunded`.
Order struct: amount, buyer, seller, state, fundedAt, releasedAt.

Functions:
- `createOrder(bytes32 orderId, uint256 amount, address buyer, address seller)` only agent/owner. Must equal `amount` of sUSD. Sets state Created (must already be Created).
- `fund(bytes32 orderId)` buyer calls; pull-then-push: buyer `approve`s token first, contract does `transferFrom(buyer, address(this), amount)`; state Created→Funded.
- `confirmShipment(bytes32 orderId)`, only agent; Funded→ShipmentConfirmed.
- `release(bytes32 orderId)`, only agent; ShipmentConfirmed→Released; transfers amount to seller; sets releasedAt.
- `raiseDispute(bytes32 orderId)` , buyer or seller; Funded|ShipmentConfirmed→Disputed.
- `resolve(bytes32 orderId, uint8 decision)` , only reviewer; Disputed→ (0: Released + pay seller) | (1: Refunded + pay buyer).

Events (all include `orderId`): `OrderCreated(bytes32 indexed orderId, uint256 amount, address buyer, address seller)`, `OrderFunded(bytes32 orderId, uint256 amount)`, `ShipmentConfirmed(bytes32 orderId)`, `FundsReleased(bytes32 orderId, address seller, uint256 amount)`, `DisputeRaised(bytes32 orderId, address by)`, `DisputeResolved(bytes32 orderId, uint8 decision)`.

Revert with clear messages on wrong state/role.

### Deployment artifact contract (CRITICAL)
`scripts/deploy.js` deploys MockStableCoin + SilkEscrow, mints 1,000,000 sUSD each to Hardhat accounts #3..#6 (test buyers) and sets agent=account #2, reviewer=account #3, then writes:

```json
// contracts/deployments/latest.json
{
  "network": "local",
  "rpcUrl": "http://127.0.0.1:8545",
  "tokenAddress": "0x…",
  "escrowAddress": "0x…",
  "agentAddress": "0x…",
  "reviewerAddress": "0x…",
  "agentPrivateKey": "0x…",      // hardhat account #2 private key (local testnet only)
  "buyerPrivateKeys": ["0x…","#…"], // accounts #4..#7
  "abis": { "SilkEscrow": [...], "MockStableCoin": [...] }  // full ABIs from artifacts
}
```
The backend reads this file. If it is missing or the RPC is unreachable, the backend falls back to its internal **simulated chain** (deterministic fake tx hashes) so the demo never breaks. Also provide `scripts/deploy.js` + `test/SilkEscrow.test.js` (states, role checks, dispute path) runnable via `npx hardhat test`.

## 2. ML package (`silkflow/ml/`)

Pure Python package importable as `ml` (repo root on PYTHONPATH). Runnable WITHOUT xgboost/shap: try to import, else use documented fallbacks (sklearn logistic regression + coefficient-based explanations, or pure-numpy logistic regression if even sklearn is missing). `requirements.txt` in `ml/` lists: numpy, pandas, scikit-learn, xgboost, shap, joblib (optional ones marked).

- `python -m ml.generate_data` → writes `ml/data/synthetic_trades.csv` (~5000 rows, labeled synthetic; assumptions documented in `docs/DATA_MODEL.md` written by the ML builder).
- `python -m ml.train` → trains scorer (XGBoost or LR baseline), Isolation Forest, saves to `ml/artifacts/`.
- `ml/service.py` public API used by the backend (must work after `train` ran; if artifacts missing, auto train quickly on generated data at import):

```python
score_trade(features: dict) -> {
  "score": 0-100 float (higher = safer),
  "risk_band": "low"|"medium"|"high",
  "suggested_terms": {"escrow_pct": int, "requires_review": bool, "min_documents": int},
  "top_features": [{"name": str, "label": str, "impact": float, "direction": "increase"|"decrease"}],  # ≤5, sorted by |impact|
  "model_version": str
}
anomaly_check(features: dict) -> {"is_anomaly": bool, "flags": [str]}
retrain(dataset_ref=None) -> {"job_id": str, "status": str, "model_version": str, "metrics": dict}
FEATURE_LABELS: dict[str, str]  # human-readable labels for each feature
```

### Canonical `features` dict (backend builds and passes this)
```json
{ "past_orders": int, "on_time_rate": 0-1, "buyer_avg_days_to_pay": float,
  "buyer_country_risk": 0-1, "invoice_to_avg_ratio": float,
  "doc_discrepancy_count": int, "payment_term_days": int,
  "fx_volatility": 0-1, "amount_usd": float, "goods_category": str }
```

## 3. Backend API (`silkflow/api/`)

FastAPI app `app/main.py`, run with `uvicorn app.main:app --port 8000` from `api/`. SQLite (SQLAlchemy 2.x, file `api/silkflow.db`), auto-created + seeded on first launch. CORS allow `http://localhost:5173`, `http://127.0.0.1:5173`. If a dependency can't be installed on this Python, use stdlib fallbacks (pbkdf2 hashing, PyJWT-or-stdlib token). Keep `api/requirements.txt`.

### Auth
JWT access (30 min) + refresh (7 d). Roles: `exporter` (seller), `buyer`, `reviewer`, `admin`. Seeded users (password `Password123!` for all):
- seller@coretech.io (Ayesha Textiles, exporter), seller2@coretech.io (exporter)
- buyer@globalmart.pk (buyer), buyer2@globalmart.pk (buyer)
- reviewer@coretech.io (reviewer), admin@coretech.io (admin)
Each seeded exporter/buyer business gets a deterministic wallet address (in simulated mode: any valid 20-byte address; in chain mode, mapped to hardhat accounts from latest.json buyer list in order; document mapping in `api/chain_accounts.py`).

### Tables (SQLAlchemy)
Exactly the 15 tables from the handoff doc §4 (users, roles, businesses, orders, documents, document_checks, credit_scores, escrows, shipment_events, agent_actions, disputes, fx_snapshots, audit_entries, models) + `settings` (key/value JSON: `auto_release_limit`=25000, `kill_switch`=false, `reviewer_threshold_score`=60, `max_release_per_order`=1) + v2 tables: `cashflow_items` (receipt|payment flows, auto|manual), `cashflow_forecasts` (weekly projected balance + gap flag), `financing_offers` (ranked simulated offers), `alerts` (cash_gap|shipment|funding|release|escalation). `businesses.opening_balance` feeds the forecaster.

Order status enum (string): `draft, docs_checked, scored, awaiting_funding, funded, shipped, released, settled, disputed, resolved, rejected`.

Audit chain: `entry_hash = sha256hex(previous_hash + str(order_id or 0) + data_hash + str(timestamp))`, genesis previous_hash = 64 zeros.

### Endpoints + exact response shapes
All under `/api`. Auth: `Authorization: Bearer <access_token>`. Webhook uses header `X-Webhook-Secret: silkflow-demo` (no JWT).

- `POST /api/auth/register` {name,email,password,role} → 201 {id,email,role}
- `POST /api/auth/login` {email,password} → {access_token,refresh_token,role,user:{id,name,email,role}}
- `POST /api/auth/refresh` {refresh_token} → {access_token}
- `POST /api/auth/logout` → {ok:true} (token revoked via jti denylist)
- `POST /api/businesses` {legal_name,country,wallet_address?} → {id,legal_name,country,kyb_status:"verified",wallet_address} (auto-approve mock KYB; sets user.business_id)
- `GET /api/businesses/me` → same shape
- `POST /api/orders` {buyer_id,goods,quantity,amount,currency,payment_term_days,ship_by} → Order object below. seller_id from token.
- `GET /api/orders?status=&date_from=&date_to=&limit=&offset=` → `{"orders":[Order],"total":n,"limit":l,"offset":o}` role-scoped (exporter: own as seller; buyer: own as buyer; reviewer/admin: all; limit 0 = all, capped at 200). Order object:
```json
{"id":1,"seller_id":2,"buyer_id":3,"seller_name":"Ayesha Textiles","buyer_name":"GlobalMart",
 "goods":"Cotton bed linens","quantity":500,"amount":18000.0,"currency":"USD",
 "payment_term_days":30,"ship_by":"2026-11-01","status":"scored","created_at":"ISO8601",
 "risk_band":"low","score":82.5,"escrow_state":"Funded"}
```
- `GET /api/orders/{id}` → Order + full nested detail:
```json
{ ...Order, "business_seller":{...}, "business_buyer":{...},
  "documents":[{"id":1,"type":"invoice","file_name":"inv.pdf","uploaded_at":"ISO"}],
  "document_check":{"result":"pass"|"mismatch"|"fail","checked_at":"ISO",
      "discrepancies":[{"field":"quantity","invoice_value":"500","packing_list_value":"450","severity":"high","description":"…"}]},
  "credit_score":{"score":82.5,"risk_band":"low","model_version":"v1","suggested_terms":{...},"top_features":[...]},
  "escrow":{"contract_address":"0x…","amount":18000.0,"token":"sUSD","state":"Funded",
      "buyer_wallet":"0x…","seller_wallet":"0x…","tx_fund":"0x…|null","tx_release":"0x…|null",
      "explorer_url":"sim://tx/…"},
  "shipment_events":[{"id":1,"event_type":"dispatch"|"in_transit"|"delivery","received_at":"ISO","payload":{...}}],
  "agent_actions":[{"id":1,"action":"approve_terms"|"release_funds"|"hold"|"escalate"|"reject",
      "decision":"approve"|"hold"|"escalate"|"reject"|"release","reason":"one-line explanation",
      "policy_checks":[{"rule":"auto_release_limit","passed":true,"detail":"18000 ≤ 25000"}],
      "tx_hash":"0x…|null","timestamp":"ISO"}],
  "dispute":{"id":1,"raised_by":"buyer","reason":"…","status":"open"|"resolved",
      "assigned_reviewer_id":6,"resolution":"release"|"refund","notes":"…","resolved_at":"ISO"}|null,
  "fx_note":{...see FX below...} }
```
- `POST /api/orders/{id}/documents` multipart: `file` (pdf/txt/csv), `type` (invoice|packing_list|order_terms) → {id,type,file_name}. Text extracted via pdfplumber if available else treat non-PDF as UTF-8 text (for PDFs without pdfplumber, store placeholder + allow paste-text alternative field `text`).
- `POST /api/orders/{id}/check-documents` → document_check object above (LLM if OPENAI_API_KEY set, else rule-based; `{"checker":"llm"|"rules"}` extra field allowed). Updates order status→docs_checked when run after docs exist. When the check **passes** and the order has no credit score yet, scoring runs automatically (same pipeline as `/score`). Runs automatically on `/score` if not yet checked.
- `POST /api/orders/{id}/score` → credit_score object + `anomaly` field {is_anomaly,flags}. Builds features from business history + doc check + FX; updates status→scored (or `rejected` if anomaly+high risk band; `awaiting_funding` decision stored in agent_actions as approve/escalate).
- `POST /api/orders/{id}/escrow/create` → escrow object (registers order on chain, tx_hash recorded)
- `POST /api/orders/{id}/escrow/fund` {tx_hash?} → escrow object. If chain live: backend submits fund() using buyer's hardhat key (demo convenience) or records provided tx_hash; simulated mode: fabricates hash. Also usable by buyer role from dashboard via button.
- `POST /api/webhooks/logistics` {order_id,event_type,timestamp,payload?} → {"ack":true,"event_id":n,"agent_decision": "..."} — triggers agent loop.
- `POST /api/orders/{id}/agent/run` → {"decision","reason","policy_checks":[...],"action":"…","tx_hash":…|null,"agent_action_id":n}. Agent loop per doc §8: observe → decide → policy-check → act → log. Rules: kill switch → hold; doc fail or anomaly → escalate/hold; score < reviewer_threshold → escalate; no shipment evidence → hold; amount > auto_release_limit → escalate for human release; else release. Exactly one release per order enforced.
- `POST /api/orders/{id}/disputes` {reason} → dispute object; order status→disputed.
- `POST /api/orders/{id}/simulate/shipment` → same as webhook but auth'd: fires dispatch→in_transit→delivery sequence (body {event_type?} to fire a single event; default "delivery" full-seq fires all three).
- `POST /api/orders/{id}/simulate/dispute` {reason?} → creates dispute as buyer.
- `POST /api/disputes/{id}/resolve` {decision:"release"|"refund"|"more_evidence",notes} → {dispute,audit_entry:{id,entry_hash,tx_hash}}; on-chain resolve when live; order status→resolved; escrow Released/Refunded.
- `GET /api/fx/risk?base=USD&quote=PKR&days=30` → {"base","quote","days","rate":float,"volatility_pct":float,"exposure_pct":float,"note":"one-sentence risk statement","source":"live"|"cache"|"synthetic"}
- `GET /api/audit-trail?order_id=&date_from=&date_to=&q=&limit=100&offset=0` → {"total":n,"entries":[{"id","order_id","order_ref","action","actor","data_hash","previous_hash","entry_hash","tx_hash","timestamp"}]}
- `GET /api/audit-trail/verify` → {"valid":bool,"checked":n,"broken_entry_id":int|null}
- `POST /api/audit-trail/tamper/{entry_id}` (admin) → flips a stored hash so integrity check fails (demo scenario 3) → {ok:true}
- `GET /api/reports/summary?date_from=&date_to=` → {"totals":{orders,settled_value,released_count,disputes,dispute_rate,avg_score},"by_status":{...},"by_risk_band":{...},"recent":[Order…]} (frontend renders; CSV download client-side)
- `GET /api/admin/users` → {"users":[{id,name,email,role,status,created_at}]}; `PATCH /api/admin/users/{id}` {status:"active"|"suspended"} → user
- `GET /api/models` → {"models":[{"id","version","trained_on","is_active":bool,"metrics":{auc,accuracy,precision,recall,f1,threshold,confusion_matrix,baseline:{...same...},scorer,anomaly,explanations,synthetic}}]}
- `POST /api/models/retrain` {dataset_ref?} → {"job_id","status":"completed","model_version","metrics"} (calls ml.service.retrain synchronously)
- `GET /api/admin/settings` → settings object; `PUT /api/admin/settings` partial {auto_release_limit?,kill_switch?,reviewer_threshold_score?} → settings
- `POST /api/admin/agent/pause` → {"agent_state":"paused","kill_switch":true}; `POST /api/admin/agent/resume` → {"agent_state":"active"}
- `GET /api/health` → {"status":"ok","chain":"live"|"simulated","models_loaded":bool,"version"}
- `GET /api/stats/live` (reviewer) → {"orders_total","awaiting_review","open_disputes","released_today","chain_mode"} — used for live-feed polling.

### v2 SME-copilot endpoints (router `api/app/routers/finance.py`)
All numbers are computed by deterministic Python (`cashflow_service`, `financing_service`) — the LLM only explains, never calculates or authorizes money movement.

- `GET /api/businesses/{id}/cashflow?weeks=12` (4..26; exporter own business, reviewer/admin any) → `{business_id, opening_balance, current_balance, horizon_weeks, expected_receipts_30d, lowest_projected_balance, lowest_week:"dd Mon yyyy", gap_weeks:int, weeks:[{week_start, week_label:"dd Mon", receipts (net flow, negative in payment weeks), projected_balance, gap:bool}], method, alerts:[Alert]}`. Rebuilds auto receipt items from orders, persists the weekly forecast, and raises a `cash_gap` alert when a negative week appears. Manual items (kind="payment", source="manual") are scheduled outflows entered by the exporter and survive rebuilds.
- `POST /api/businesses/{id}/cashflow/scenario` {order_id, delay_days (0..180)} → `{scenario:{order_id,delay_days}, forecast:<same shape, no alerts>, delta:{gap_weeks, lowest_balance_change}, note}` — what-if only; the persisted forecast is never mutated. 403 if the order is not the caller's.
- `GET /api/orders/{id}/financing-options` (party-scoped) → `{order_id, simulated:true, disclaimer, offers:[{id, order_id, business_id, offer_type, amount, fee_pct, term_days, rank, reason, status:"available"|"requested", simulated:true, net_payout, estimated_cost, created_at}]}`. Lazy-generates 3 ranked offers (Invoice Advance / FX-Bridged Advance / Working-Capital Top-Up) from the latest credit score; 409 when unscored. Ranking = annualised cost `amount·fee/100·term/360`, fees by risk band (low 2.9%, medium 4.5%, high 6.9%).
- `POST /api/orders/{id}/financing-requests` {offer_id} → 201 offer object; only the selling exporter; idempotent (re-applying returns the same offer, `status:"requested"`, no duplicate rows or alerts). Raises a `funding` alert labelled prototype-only.
- `GET /api/alerts?unread=&business_id=&limit=&offset=` → `{alerts:[Alert], total, limit, offset, unread}`; Alert = `{id, business_id, type:"cash_gap"|"shipment"|"funding"|"release"|"escalation", message, severity:"info"|"warning"|"critical", order_id, created_at, read_at}`. Exporters see only their own; reviewer/admin see all. De-dupe: identical messages never repeat; one unread cash_gap per business.
- `POST /api/alerts/{id}/read` → updated Alert (owner or reviewer/admin only).
- `POST /api/copilot/ask` {question (3..1000), business_id? (reviewer/admin only)} → `{answer, mode:"llm:<model>"|"deterministic-demo", cited_figures:[…], disclaimer}`. Answers are grounded in a fact sheet built from the caller's own forecast/orders/scores/offers/alerts; OpenAI is used only when `OPENAI_API_KEY` is set, else an explicitly-labelled deterministic template demo. 403 on cross-business access; audit-logged as `copilot_ask`.

Auth hardening: `POST /api/auth/register|login|refresh` are rate-limited per client IP by an in-memory token bucket (10 req/min, 429 on excess — `api/app/ratelimit.py`). `GET /api/orders` and `GET /api/audit-trail` support `limit`/`offset` and return `{…total}`. Active-model metrics (`GET /api/models`) now include precision/recall/F1/confusion matrix and the LogisticRegression `baseline` block.

### Backend module layout
```
api/app/main.py, db.py, models.py, schemas.py, security.py, deps.py, seed.py
api/app/routers/  auth.py businesses.py orders.py agent.py escrow.py disputes.py fx.py audit.py admin.py reports.py webhooks.py
api/app/services/ chain.py (web3 + simulated fallback), ml_bridge.py, doc_check.py, agent_loop.py, policy.py, fx_service.py, notify.py (in-app: writes agent_actions/notifications; no real email)
```
`chain.py`: reads `contracts/deployments/latest.json`; if RPC reachable AND file exists → live mode; else simulated mode with deterministic sha256-based fake hashes and an in-memory escrow state mirror. Expose: `create_escrow(order)`, `fund_escrow(order)`, `confirm_shipment(order)`, `release(order)`, `dispute(order)`, `resolve(order, decision)`, `status()` → {"mode","escrow_address","token_address"}.

## 4. Dashboard (`silkflow/dashboard/`)

Vite + React 18 + Tailwind + react-router-dom + react-chartjs-2 (chart.js). `vite.config.js` proxies `/api` → `http://127.0.0.1:8000`.

Design system: deep navy (`#0B1F3A` bg), gold accent (`#D4AF37`), white cards `#12294a`/slate-800 surfaces, Inter font, generous spacing, subtle borders `border-white/10`, rounded-xl. Status pills color-coded. Reusable components: `StatCard`, `StatusPill`, `EscrowTracker` (Created→Funded→Shipped→Released), `ScoreGauge` (doughnut 0-100), `ReasonsBarChart` (horizontal bar, +/- impact), `HashLink` (monospace truncated hash), `Timeline`, `Modal`, `EmptyState`, `Spinner`.

Routes:
- `/login` centered navy card, logo, gold button. Also `/register`.
- Role landing after login: exporter→`/orders`, buyer→`/inbox`, reviewer/admin→`/feed`.
- Exporter: `/orders` (list + status pills), `/orders/new`, `/orders/:id` (two-column layout per doc §6: left terms/documents/doc-check w/ highlighted mismatches, right ScoreGauge + ReasonsBarChart + EscrowTracker + FX panel below), `/payments` (history + settlement summary download).
- Buyer: `/inbox`, `/orders/:id` terms review + Accept, Fund Escrow screen (address+amount highlighted box, status line), Confirm Receipt / Raise Dispute.
- Reviewer/Admin: shell with top navbar (Logo | Live Feed | Case Queue | Audit Trail | Reports | Settings | Profile/Logout) + left contextual sidebar filters on Case Queue (status, risk band, date). `/feed` (live, polls /api/stats/live + orders every 5 s), `/cases` queue filterable, `/cases/:id` 3-panel detail (documents | shipment timeline | agent reasoning w/ per-rule pass/fail) + Resolve bar (Release/Refund/Request evidence + notes), `/audit` vertical hash-chain viewer + Verify Integrity button (green all-valid / red broken entry highlight), `/reports`, `/models` (versions+metrics, Retrain button), `/settings` (policy limits + Kill Switch toggle), `/admin/users`.
- Every order screen shows Simulate Shipment / Simulate Dispute buttons (reviewer & exporter) for the demo.
- API client `src/api.js`: attaches JWT, redirects to /login on 401, exposes typed helpers per endpoint; `src/auth.jsx`: context + `RequireRole` guard.

## 5. Root scripts
- `run.ps1` / `run.sh`: start chain (if node available) → deploy → train models → seed → uvicorn → vite. (Integration owner writes these; builders just make their part runnable standalone: contracts `npm test`, ml `python -m ml.train`, api `uvicorn app.main:app`, dashboard `npm run dev`.)
- Demo accounts + password: `Password123!` (document on login page footer as "Demo: seller@coretech.io / Password123!").
