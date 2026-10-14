"""Document checker: text extraction + structured discrepancy comparison.

Rule-based comparator parses key fields (invoice number, buyer, seller, goods,
quantity, unit price, total amount, currency, dates) from invoice / packing
list / order terms and cross-checks them against each other and against the
DB order terms. If OPENAI_API_KEY is set, an LLM pass via httpx is attempted
with a strict-JSON prompt; output is validated and repaired once, else the
rule-based result is used.
"""
import json
import logging
import os
import re
import time
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import OPENAI_API_KEY, OPENAI_MODEL
from ..models import Business, Document, DocumentCheck, Order

log = logging.getLogger("silkflow.doccheck")

FIELD_PATTERNS = {
    "invoice_number": r"invoice\s*(?:no|number|#)\s*[:=]\s*(\S+)",
    "date": r"(?:invoice\s*)?date\s*[:=]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\s+\w+\s+[0-9]{4})",
    "seller": r"(?:seller|exporter|shipper|consignor)\s*[:=]\s*(.+)",
    "buyer": r"(?:buyer|importer|consignee)\s*[:=]\s*(.+)",
    "goods": r"(?:goods|description(?:\s+of\s+goods)?|commodity|item)\s*[:=]\s*(.+)",
    "quantity": r"quantity\s*[:=]\s*([0-9][0-9,\.]*)",
    "unit_price": r"unit\s*price\s*[:=]?\s*([0-9][0-9,\.]*)",
    "total_amount": r"(?:total(?:\s*amount)?|amount\s*due|invoice\s*total)\s*[:=]?\s*([0-9][0-9,\.]*)",
    "currency": r"\b(USD|EUR|GBP|PKR|CNY|AED|INR|BDT|VND)\b",
    "ship_by": r"ship(?:ping)?(?:\s+date|\s+by)?\s*[:=]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\s+\w+\s+[0-9]{4})",
}


def extract_text(file_path: str | Path, raw: bytes | None = None) -> str:
    """pdfplumber for PDFs, else UTF-8 decode."""
    p = Path(file_path)
    is_pdf = (raw[:5] == b"%PDF-") if raw else p.suffix.lower() == ".pdf"
    if is_pdf:
        try:
            import pdfplumber
            with pdfplumber.open(str(p)) as pdf:
                return "\n".join((page.extract_text() or "") for page in pdf.pages)
        except Exception as exc:
            log.warning("pdf extraction failed for %s (%s) — placeholder", p, exc)
            return "[PDF text unavailable — paste text alternative supported]"
    if raw is not None:
        return raw.decode("utf-8", errors="replace")
    return p.read_text(encoding="utf-8", errors="replace")


def parse_fields(text: str) -> dict:
    out = {}
    for field, pat in FIELD_PATTERNS.items():
        m = re.search(pat, text, re.IGNORECASE)
        if not m:
            continue
        val = m.group(1).strip().rstrip(".")
        if field in ("quantity",):
            out[field] = _num(val)
        elif field in ("unit_price", "total_amount"):
            out[field] = _num(val)
        else:
            out[field] = val
    return out


def _num(s: str) -> float | None:
    try:
        return float(re.sub(r"[^0-9\.]", "", s.replace(",", "")) or "0")
    except ValueError:
        return None


def _norm_name(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r"\(.*?\)", "", s.lower())
    return re.sub(r"\b(co|ltd|limited|pvt|inc|llc|company|corp|traders|textiles co)\b", " ", s).strip()


def _name_close(a: str, b: str) -> bool:
    na, nb = _norm_name(a), _norm_name(b)
    if not na or not nb:
        return True  # absent field is not a mismatch
    if na in nb or nb in na:
        return True
    ta, tb = set(na.split()), set(nb.split())
    return bool(ta & tb) and len(ta & tb) / max(len(ta | tb), 1) >= 0.4


def _disc(field, a, b, severity, description):
    return {"field": field, "invoice_value": None if a is None else str(a),
            "packing_list_value": None if b is None else str(b),
            "severity": severity, "description": description}


def compare_rules(order: Order, docs: dict[str, str], db: Session) -> tuple[str, list[dict]]:
    """docs: {type: extracted_text}. Returns (result, discrepancies)."""
    inv = parse_fields(docs.get("invoice", ""))
    pl = parse_fields(docs.get("packing_list", ""))
    ot = parse_fields(docs.get("order_terms", ""))

    seller = db.get(Business, order.seller_id)
    buyer = db.get(Business, order.buyer_id)
    disc: list[dict] = []
    result = "pass"

    if not docs.get("invoice"):
        return "fail", [_disc("invoice", None, None, "high", "No invoice document uploaded")]

    # --- invoice vs packing list ------------------------------------------------
    if inv.get("quantity") is not None and pl.get("quantity") is not None:
        if abs(inv["quantity"] - pl["quantity"]) > 1e-6:
            disc.append(_disc("quantity", inv["quantity"], pl["quantity"], "high",
                              f"Quantity mismatch: invoice {inv['quantity']:g} vs packing list {pl['quantity']:g}"))
    if inv.get("goods") and pl.get("goods") and not _name_close(inv["goods"], pl["goods"]):
        disc.append(_disc("goods", inv["goods"], pl["goods"], "medium",
                          "Goods description differs between invoice and packing list"))
    for fld, sev in (("buyer", "high"), ("seller", "high")):
        if inv.get(fld) and pl.get(fld) and not _name_close(inv[fld], pl[fld]):
            disc.append(_disc(fld, inv[fld], pl[fld], sev,
                              f"{fld.capitalize()} name differs between invoice and packing list"))
    if inv.get("invoice_number") and pl.get("invoice_number") and \
            inv["invoice_number"] != pl["invoice_number"]:
        disc.append(_disc("invoice_number", inv["invoice_number"], pl["invoice_number"], "low",
                          "Packing list references a different invoice number"))

    # --- invoice vs order terms (DB + uploaded terms doc) -----------------------
    if inv.get("quantity") is not None and abs(inv["quantity"] - order.quantity) > 1e-6:
        disc.append(_disc("quantity", inv["quantity"], order.quantity, "high",
                          f"Invoice quantity {inv['quantity']:g} differs from contracted {order.quantity}"))
    if inv.get("total_amount") is not None and abs(inv["total_amount"] - order.amount) / max(order.amount, 1) > 0.02:
        disc.append(_disc("total_amount", inv["total_amount"], order.amount, "high",
                          f"Invoice total {inv['total_amount']:,.2f} differs from contract value {order.amount:,.2f}"))
    if inv.get("currency") and order.currency and inv["currency"].upper() != order.currency.upper():
        disc.append(_disc("currency", inv["currency"], order.currency, "medium",
                          "Invoice currency differs from contract currency"))
    if buyer and inv.get("buyer") and not _name_close(inv["buyer"], buyer.legal_name):
        disc.append(_disc("buyer", inv["buyer"], buyer.legal_name, "medium",
                          "Invoice buyer does not clearly match contracted buyer"))
    if seller and inv.get("seller") and not _name_close(inv["seller"], seller.legal_name):
        disc.append(_disc("seller", inv["seller"], seller.legal_name, "medium",
                          "Invoice seller does not clearly match contracted seller"))
    if ot.get("total_amount") and inv.get("total_amount") and \
            abs(ot["total_amount"] - inv["total_amount"]) / max(inv["total_amount"], 1) > 0.02:
        disc.append(_disc("total_amount", inv["total_amount"], ot["total_amount"], "high",
                          "Order-terms amount differs from invoice total"))
    ship = inv.get("ship_by") or ot.get("ship_by")
    if ship and order.ship_by and _norm_date(ship) != _norm_date(order.ship_by):
        disc.append(_disc("ship_by", ship, order.ship_by, "low",
                          "Ship-by date differs from contract"))

    # cross-check unit price * quantity vs total (internal invoice consistency)
    if inv.get("unit_price") and inv.get("quantity") and inv.get("total_amount"):
        implied = inv["unit_price"] * inv["quantity"]
        if abs(implied - inv["total_amount"]) / max(inv["total_amount"], 1) > 0.02:
            disc.append(_disc("unit_price", f"{inv['unit_price']:g} x {inv['quantity']:g} = {implied:,.2f}",
                              inv["total_amount"], "medium",
                              "Invoice line math does not match stated total"))

    sevs = {d["severity"] for d in disc}
    if "high" in sevs:
        result = "fail"
    elif disc:
        result = "mismatch"
    return result, disc


def _norm_date(s: str) -> str:
    s = str(s).strip()
    m = re.match(r"([0-9]{4})-([0-9]{2})-([0-9]{2})", s)
    if m:
        return s[:10]
    m = re.match(r"([0-9]{1,2})\s+([A-Za-z]+)\s+([0-9]{4})", s)
    if m:
        months = "janfebmaraprmayjunjulaugsepoctnovdec"
        mi = months.find(m[2][:3].lower()) // 3 + 1
        return f"{m[3]}-{mi:02d}-{int(m[1]):02d}"
    return s


# --- optional LLM path ----------------------------------------------------------
LLM_SYSTEM = (
    "You are a trade-document checker. Compare the invoice, packing list and order "
    "terms. Respond with STRICT JSON only: {\"result\":\"pass|mismatch|fail\","
    "\"discrepancies\":[{\"field\":str,\"invoice_value\":str|null,"
    "\"packing_list_value\":str|null,\"severity\":\"low|medium|high\",\"description\":str}]}. "
    "No prose, no markdown fences."
)


def _validate_llm(obj) -> dict | None:
    try:
        if obj["result"] not in ("pass", "mismatch", "fail"):
            return None
        out = []
        for d in obj["discrepancies"]:
            out.append({"field": str(d["field"]),
                        "invoice_value": None if d.get("invoice_value") is None else str(d["invoice_value"]),
                        "packing_list_value": None if d.get("packing_list_value") is None else str(d["packing_list_value"]),
                        "severity": d["severity"] if d["severity"] in ("low", "medium", "high") else "medium",
                        "description": str(d["description"])})
        return {"result": obj["result"], "discrepancies": out}
    except Exception:
        return None


def _llm_check(docs: dict[str, str], order_terms: str) -> dict | None:
    if not OPENAI_API_KEY:
        return None
    try:
        import httpx
        content = (f"ORDER TERMS:\n{order_terms}\n\n"
                   + "\n\n".join(f"{k.upper()}:\n{v}" for k, v in docs.items()))
        msgs = [{"role": "system", "content": LLM_SYSTEM},
                {"role": "user", "content": content}]
        for attempt in range(2):
            r = httpx.post("https://api.openai.com/v1/chat/completions",
                           headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                           json={"model": OPENAI_MODEL, "messages": msgs, "temperature": 0,
                                 "response_format": {"type": "json_object"}}, timeout=30)
            raw = r.json()["choices"][0]["message"]["content"]
            try:
                parsed = _validate_llm(json.loads(raw))
            except Exception:
                parsed = None
            if parsed:
                return parsed
            msgs.append({"role": "assistant", "content": raw})
            msgs.append({"role": "user", "content": "That was not valid strict JSON. "
                         "Return ONLY the JSON object described in the system message."})
        log.warning("LLM doc check output invalid -> falling back to rules")
        return None
    except Exception as exc:
        log.warning("LLM doc check failed (%s) -> falling back to rules", exc)
        return None


def run_check(db: Session, order: Order) -> DocumentCheck:
    """Extract, compare, persist DocumentCheck and move status to docs_checked."""
    docs = (db.query(Document).filter(Document.order_id == order.id).all())
    by_type: dict[str, str] = {}
    for d in docs:
        by_type[d.type] = d.extracted_text or ""
    terms_text = by_type.get("order_terms") or _order_terms_text(order, db)

    llm = _llm_check(by_type, terms_text)
    if llm:
        result, discrepancies, checker = llm["result"], llm["discrepancies"], "llm"
    else:
        result, discrepancies = compare_rules(order, by_type, db)
        checker = "rules"

    row = DocumentCheck(order_id=order.id, result=result,
                        discrepancies_json=discrepancies, checker=checker)
    db.add(row)
    # (re)checking documents only moves a draft forward; later states are preserved
    if order.status == "draft":
        order.status = "docs_checked"
    db.flush()
    return row


def _order_terms_text(order: Order, db: Session) -> str:
    seller = db.get(Business, order.seller_id)
    buyer = db.get(Business, order.buyer_id)
    return (f"ORDER TERMS\nSeller: {seller.legal_name if seller else ''}\n"
            f"Buyer: {buyer.legal_name if buyer else ''}\nGoods: {order.goods}\n"
            f"Quantity: {order.quantity} units\nUnit Price: "
            f"{order.amount / max(order.quantity, 1):.2f} {order.currency}\n"
            f"Total Amount: {order.amount:.2f} {order.currency}\n"
            f"Payment Terms: Net {order.payment_term_days}\nShip By: {order.ship_by}")


def check_to_dict(row: DocumentCheck) -> dict:
    return {"id": row.id, "result": row.result, "checker": row.checker,
            "checked_at": row.checked_at,
            "discrepancies": row.discrepancies_json or []}
