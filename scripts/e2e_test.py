"""End-to-end integration test against a running SilkFlow API.
Run: python scripts/e2e_test.py   (API on 127.0.0.1:8000)
"""
import json
import sys
import time

import httpx

BASE = "http://127.0.0.1:8000/api"
PW = "Password123!"
PASS, FAIL = 0, 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {extra}")


def login(email):
    r = c.post(f"{BASE}/auth/login", json={"email": email, "password": PW})
    r.raise_for_status()
    d = r.json()
    return {"Authorization": f"Bearer {d['access_token']}", "refresh": d["refresh_token"]}


c = httpx.Client(timeout=30)

print("== health & auth ==")
h = c.get(f"{BASE}/health").json()
check("health ok", h["status"] == "ok", h)
seller = login("seller@coretech.io")
buyer = login("buyer@globalmart.pk")
reviewer = login("reviewer@coretech.io")
admin = login("admin@coretech.io")
check("roles correct", seller and buyer and reviewer and admin)

r = c.post(f"{BASE}/auth/login", json={"email": "seller@coretech.io", "password": "wrong"})
check("bad password rejected", r.status_code == 401)
check("seeded orders visible", len(c.get(f"{BASE}/orders", headers=seller).json()["orders"]) >= 4)

print("== clean settlement flow (new order) ==")
o = c.post(f"{BASE}/orders", headers=seller, json={
    "buyer_id": 3, "goods": "Cotton bath towels, premium", "quantity": 700, "amount": 15400,
    "currency": "USD", "payment_term_days": 30, "ship_by": "2026-11-20"}).json()
oid = o["id"]
check("order created draft", o["status"] == "draft", o)

inv = ("COMMERCIAL INVOICE\nInvoice No: INV-E2E-1\nDate: 2026-10-08\n"
       f"Seller: Ayesha Textiles\nBuyer: GlobalMart Traders\nGoods: Cotton bath towels, premium\n"
       "Quantity: 700\nUnit Price: 22.00\nTotal Amount: 15400.00 USD\nShip By: 2026-11-20\n")
pl = ("PACKING LIST\nInvoice No: INV-E2E-1\nDate: 2026-10-08\n"
      f"Seller: Ayesha Textiles\nBuyer: GlobalMart Traders\nGoods: Cotton bath towels, premium\n"
      "Quantity: 700\nTotal Amount: 15400.00 USD\nCartons: 7\nGross Weight: 245.0 kg\n")
d1 = c.post(f"{BASE}/orders/{oid}/documents", headers=seller,
            data={"type": "invoice"}, files={"file": ("invoice.txt", inv, "text/plain")}).json()
d2 = c.post(f"{BASE}/orders/{oid}/documents", headers=seller,
            data={"type": "packing_list"}, files={"file": ("packing.txt", pl, "text/plain")}).json()
check("documents uploaded", d1.get("id") and d2.get("id"))

dc = c.post(f"{BASE}/orders/{oid}/check-documents", headers=seller).json()
check("doc check pass", dc["result"] in ("pass", "mismatch"), dc)

sc = c.post(f"{BASE}/orders/{oid}/score", headers=seller).json()
check("scored 0-100", 0 <= sc["score"] <= 100, sc)
check("risk band valid", sc["risk_band"] in ("low", "medium", "high"))
check("top features present", len(sc["top_features"]) >= 3)

esc = c.post(f"{BASE}/orders/{oid}/escrow/create", headers=buyer).json()
check("escrow created", esc["state"] == "Created", esc)
check("create tx hash", (esc["tx_create"] or "").startswith("0x"))

funded = c.post(f"{BASE}/orders/{oid}/escrow/fund", headers=buyer, json={}).json()
check("escrow funded", funded["state"] == "Funded", funded)

wb = c.post(f"{BASE}/webhooks/logistics",
            headers={"X-Webhook-Secret": "silkflow-demo"},
            json={"order_id": oid, "event_type": "dispatch"}).json()
check("webhook ack", wb["ack"] is True, wb)

c.post(f"{BASE}/webhooks/logistics", headers={"X-Webhook-Secret": "silkflow-demo"},
       json={"order_id": oid, "event_type": "in_transit"})
final = c.post(f"{BASE}/webhooks/logistics", headers={"X-Webhook-Secret": "silkflow-demo"},
               json={"order_id": oid, "event_type": "delivery"}).json()
check("agent released on delivery", final["agent_decision"] == "release", final)

detail = c.get(f"{BASE}/orders/{oid}", headers=seller).json()
check("order settled", detail["status"] == "settled", detail["status"])
check("release tx recorded", (detail["escrow"]["tx_release"] or "").startswith("0x"))
check("fx note attached", detail["fx_note"] and "volatility_pct" in detail["fx_note"])

print("== policy enforcement ==")
# kill switch blocks a release: fund + deliver an order while paused
o2 = c.post(f"{BASE}/orders", headers=seller, json={
    "buyer_id": 3, "goods": "Linen shirt fabric", "quantity": 300, "amount": 8100,
    "currency": "USD", "payment_term_days": 30, "ship_by": "2026-12-01"}).json()
oid2 = o2["id"]
c.post(f"{BASE}/orders/{oid2}/documents", headers=seller, data={"type": "invoice"},
       files={"file": ("i.txt", inv.replace("700", "300").replace("15400", "8100")
                       .replace("22.00", "27.00").replace("INV-E2E-1", "INV-E2E-2"), "text/plain")})
c.post(f"{BASE}/orders/{oid2}/documents", headers=seller, data={"type": "packing_list"},
       files={"file": ("p.txt", pl.replace("700", "300").replace("15400", "8100")
                       .replace("INV-E2E-1", "INV-E2E-2"), "text/plain")})
c.post(f"{BASE}/orders/{oid2}/score", headers=seller)
c.post(f"{BASE}/orders/{oid2}/escrow/fund", headers=buyer, json={})
c.post(f"{BASE}/admin/agent/pause", headers=admin)
held = c.post(f"{BASE}/orders/{oid2}/agent/run", headers=reviewer).json()
check("kill switch holds release", held["decision"] == "hold", held)
check("policy check logged fail", any(not p["passed"] for p in held["policy_checks"]))
# dispute now blocks even after resume
c.post(f"{BASE}/admin/agent/resume", headers=admin)
disp = c.post(f"{BASE}/orders/{oid2}/disputes", headers=buyer,
              json={"reason": "Wrong color shipped on 40% of units"}).json()
check("dispute created", disp["status"] == "open", disp)
od = c.get(f"{BASE}/orders/{oid2}", headers=buyer).json()
check("order disputed", od["status"] == "disputed")
held2 = c.post(f"{BASE}/orders/{oid2}/agent/run", headers=reviewer).json()
check("dispute freezes agent", held2["decision"] == "hold", held2)

# reviewer resolves with refund
res = c.post(f"{BASE}/disputes/{disp['id']}/resolve", headers=reviewer,
             json={"decision": "refund", "notes": "Evidence supports buyer"}).json()
check("dispute resolved", res["dispute"]["status"] == "resolved", res)
check("audit entry from resolution", res["audit_entry"]["entry_hash"], res["audit_entry"])
od2 = c.get(f"{BASE}/orders/{oid2}", headers=reviewer).json()
check("order resolved + escrow refunded", od2["status"] == "resolved"
      and od2["escrow"]["state"] == "Refunded", (od2["status"], od2["escrow"]["state"]))

print("== reviewer surfaces ==")
live = c.get(f"{BASE}/stats/live", headers=reviewer).json()
check("stats live", all(k in live for k in
                        ("orders_total", "awaiting_review", "open_disputes", "chain_mode")), live)
rep = c.get(f"{BASE}/reports/summary", headers=reviewer).json()
check("report totals", rep["totals"]["orders"] >= 7 and "by_risk_band" in rep, rep["totals"])
cases = [o for o in c.get(f"{BASE}/orders", headers=reviewer).json()["orders"]
         if o["status"] == "docs_checked"]
check("mismatch case in queue", len(cases) >= 1, [c_["status"] for c_ in cases])

print("== audit chain integrity ==")
v1 = c.get(f"{BASE}/audit-trail/verify", headers=reviewer).json()
check("chain valid", v1["valid"] is True and v1["checked"] > 30, v1)
entries = c.get(f"{BASE}/audit-trail", headers=reviewer, params={"limit": 200}).json()["entries"]
target = next(e for e in entries if e["order_id"] and e["action"].startswith("agent_"))
c.post(f"{BASE}/audit-trail/tamper/{target['id']}", headers=admin)
v2 = c.get(f"{BASE}/audit-trail/verify", headers=reviewer).json()
check("tamper detected", v2["valid"] is False and v2["broken_entry_id"] == target["id"], v2)
c.post(f"{BASE}/audit-trail/tamper/{target['id']}", headers=admin)  # flip back
v3 = c.get(f"{BASE}/audit-trail/verify", headers=reviewer).json()
check("restored valid", v3["valid"] is True, v3)

print("== models, fx, tokens ==")
mods = c.get(f"{BASE}/models", headers=reviewer).json()["models"]
check("model registered", len(mods) >= 1 and mods[0]["is_active"], mods)
rt = c.post(f"{BASE}/models/retrain", headers=admin, json={}).json()
check("retrain returns metrics", rt["status"] == "completed" and "auc" in rt["metrics"], rt)
fx = c.get(f"{BASE}/fx/risk", headers=seller, params={"base": "USD", "quote": "PKR",
                                                      "days": 30}).json()
check("fx risk note", fx["rate"] > 0 and "note" in fx, fx)

tok = c.post(f"{BASE}/auth/refresh", json={"refresh_token": seller["refresh"]}).json()
check("refresh token works", "access_token" in tok)
lo = c.post(f"{BASE}/auth/logout", headers={"Authorization": f"Bearer {tok['access_token']}"},
            json={"refresh_token": seller["refresh"]})
check("logout ok", lo.status_code == 200)
rev = c.get(f"{BASE}/orders", headers={"Authorization": f"Bearer {tok['access_token']}"})
check("revoked access token rejected", rev.status_code == 401, rev.status_code)

print("== rbac ==")
bad = c.post(f"{BASE}/admin/agent/pause", headers=buyer)
check("buyer cannot pause", bad.status_code == 403)
bad2 = c.post(f"{BASE}/orders", headers=buyer, json={"buyer_id": 3, "goods": "x", "quantity": 1,
                                                     "amount": 10, "currency": "USD",
                                                     "payment_term_days": 30, "ship_by": "2026-11-01"})
check("buyer cannot create orders", bad2.status_code == 403)
sc = c.get(f"{BASE}/audit-trail", headers=seller)
check("seller cannot read audit", sc.status_code == 403)

print("== v2: cash flow, financing, alerts, copilot ==")
seller2 = login("seller2@coretech.io")
cf = c.get(f"{BASE}/businesses/2/cashflow?weeks=12", headers=seller2).json()
check("cashflow shape", all(k in cf for k in ("opening_balance", "current_balance",
      "expected_receipts_30d", "lowest_projected_balance", "gap_weeks", "weeks"))
      and len(cf["weeks"]) == 12, list(cf))
check("gap demo: negative projection", cf["lowest_projected_balance"] < 0
      and cf["gap_weeks"] >= 1, (cf["lowest_projected_balance"], cf["gap_weeks"]))
check("gap weeks flagged", any(w["gap"] and w["projected_balance"] < 0 for w in cf["weeks"]))
forbidden = c.get(f"{BASE}/businesses/2/cashflow", headers=buyer)
check("cross-business cashflow blocked", forbidden.status_code == 403, forbidden.status_code)

s2_orders = c.get(f"{BASE}/orders", headers=seller2).json()["orders"]
sc_order = next((o for o in s2_orders if o.get("score") is not None), None)
check("seller2 has scored order", sc_order is not None, [o["status"] for o in s2_orders])
if sc_order:
    scen = c.post(f"{BASE}/businesses/2/cashflow/scenario", headers=seller2,
                  json={"order_id": sc_order["id"], "delay_days": 30}).json()
    check("scenario deltas", "delta" in scen and set(scen["delta"]) ==
          {"gap_weeks", "lowest_balance_change"} and "unchanged" in scen["note"], scen)
    cf_after = c.get(f"{BASE}/businesses/2/cashflow?weeks=12", headers=seller2).json()
    check("scenario not persisted", cf_after["lowest_projected_balance"] ==
          cf["lowest_projected_balance"])

fo = c.get(f"{BASE}/orders/3/financing-options", headers=seller).json()
offers = fo.get("offers", [])
check("3 ranked simulated offers", fo.get("simulated") is True and len(offers) == 3
      and [o["rank"] for o in offers] == [1, 2, 3], offers)
check("offer economics", all(o["amount"] > 0 and o["fee_pct"] > 0 and "net_payout" in o
                             for o in offers))
noapply = c.post(f"{BASE}/orders/3/financing-requests", headers=buyer,
                 json={"offer_id": offers[1]["id"]})
check("only exporter can apply", noapply.status_code == 403, noapply.status_code)
ap1 = c.post(f"{BASE}/orders/3/financing-requests", headers=seller,
             json={"offer_id": offers[1]["id"]})
ap2 = c.post(f"{BASE}/orders/3/financing-requests", headers=seller,
             json={"offer_id": offers[1]["id"]})
check("apply ok + idempotent", ap1.status_code == 201 and ap2.status_code == 201
      and ap1.json()["id"] == ap2.json()["id"] == offers[1]["id"]
      and ap2.json()["status"] == "requested", (ap1.status_code, ap2.status_code))
fo2 = c.get(f"{BASE}/orders/3/financing-options", headers=seller).json()
check("requested status stored", any(o["id"] == offers[1]["id"] and o["status"] == "requested"
                                     for o in fo2["offers"]))

al = c.get(f"{BASE}/alerts", headers=seller2).json()
check("cash_gap alert raised", any(a["type"] == "cash_gap" and a["severity"] in
      ("warning", "critical") for a in al["alerts"]), al["alerts"])
dup = [a["id"] for a in al["alerts"] if a["type"] == "cash_gap"]
check("no duplicate cash_gap alerts", len(dup) <= 1, dup)
if dup:
    rd = c.post(f"{BASE}/alerts/{dup[0]}/read", headers=seller2).json()
    check("alert marked read", rd["read_at"] is not None, rd)
foreign = c.post(f"{BASE}/alerts/1/read", headers=buyer)
check("cannot read other biz alert", foreign.status_code in (403, 404), foreign.status_code)

cp = c.post(f"{BASE}/copilot/ask", headers=seller,
            json={"question": "What is my current balance and lowest projected balance?"}).json()
check("copilot grounded answer", cp["mode"].startswith(("llm", "deterministic"))
      and len(cp["cited_figures"]) >= 1 and "disclaimer" in cp, cp.get("mode"))
cp_forbidden = c.post(f"{BASE}/copilot/ask", headers=seller2,
                      json={"question": "Balance?", "business_id": 1})
check("copilot respects scope", cp_forbidden.status_code == 403, cp_forbidden.status_code)
cp_rev = c.post(f"{BASE}/copilot/ask", headers=reviewer, json={"question": "Balance?"})
check("reviewer needs business_id", cp_rev.status_code == 400, cp_rev.status_code)

pg = c.get(f"{BASE}/orders?limit=2&offset=0", headers=seller).json()
check("orders paginated", len(pg["orders"]) == 2 and pg["total"] > 2 and pg["limit"] == 2,
      (len(pg["orders"]), pg["total"]))
apg = c.get(f"{BASE}/audit-trail?limit=3", headers=reviewer).json()
check("audit paginated", len(apg["entries"]) == 3 and apg["total"] > 3,
      (len(apg["entries"]), apg["total"]))

mact = next(m for m in c.get(f"{BASE}/models", headers=reviewer).json()["models"]
            if m["is_active"])
mm = mact["metrics"]
check("metrics include LR baseline + CM", "baseline" in mm and "confusion_matrix" in mm
      and mm["baseline"].get("auc", 0) > 0.5, (mm.get("auc"), mm.get("baseline", {}).get("auc")))
check("metrics labelled synthetic", mm.get("synthetic") is True, mm)

print("== auth rate limiting ==")
codes = [c.post(f"{BASE}/auth/login", json={"email": "nobody@x.io",
                                            "password": "wrong"}).status_code
         for _ in range(15)]
check("rate limiter returns 429", 429 in codes, codes)

print(f"\nRESULT: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
