// src/fixtures.js
// ---------------------------------------------------------------------------
// Dev-mode fixture layer. Shapes match API_SPEC.md §3 EXACTLY so the dashboard
// renders and every interaction works while the backend is built in parallel.
// When VITE_USE_FIXTURES is unset, src/api.js bypasses this file entirely and
// talks to the real /api endpoints.
//
// The store below is MUTABLE: demo actions (fund escrow, simulate shipment,
// raise/resolve dispute, toggle kill switch...) update it so the UI feels live
// during a click-through even without a backend.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-11T09:30:00Z').getTime()
const iso = (offsetMin = 0) => new Date(NOW + offsetMin * 60000).toISOString()
const DAY = 24 * 60

const ADDR = {
  agent: '0x2e9a71c0f5b1c8d23a4e6f0b7c8d9e0f1a2b3c4d',
  reviewer: '0x7a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d',
  escrow: '0x5c0ffee1a2b3c4d5e6f70819a2b3c4d5e6f70819',
  seller1: '0x9f8e7d6c5b4a39281706f5e4d3c2b1a098765432',
  seller2: '0x1a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4',
  buyer1: '0xdefac0ffeedeadbeef0011223344556677889900',
  buyer2: '0xfeedface1234567890abcdef1234567890abcdef',
}

const fakeHash = (seed) => {
  let h = ''
  let x = 0
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0
  for (let i = 0; i < 64; i++) {
    x = (x * 1103515245 + 12345 + i) >>> 0
    h += ((x >> (i % 24)) & 0xf).toString(16)
  }
  return '0x' + h
}

// ---- Auth accounts -------------------------------------------------------
const ACCOUNTS = {
  'seller@coretech.io': { id: 2, name: 'Ayesha Khan', email: 'seller@coretech.io', role: 'exporter', business_id: 1 },
  'seller2@coretech.io': { id: 3, name: 'Bilal Saeed', email: 'seller2@coretech.io', role: 'exporter', business_id: 2 },
  'buyer@globalmart.pk': { id: 4, name: 'Sana Malik', email: 'buyer@globalmart.pk', role: 'buyer', business_id: 3 },
  'buyer2@globalmart.pk': { id: 5, name: 'Imran Raza', email: 'buyer2@globalmart.pk', role: 'buyer', business_id: 4 },
  'reviewer@coretech.io': { id: 6, name: 'Dana Whitfield', email: 'reviewer@coretech.io', role: 'reviewer', business_id: null },
  'admin@coretech.io': { id: 1, name: 'Admin User', email: 'admin@coretech.io', role: 'admin', business_id: null },
}

const BUSINESSES = [
  { id: 1, legal_name: 'Ayesha Textiles', country: 'Pakistan', kyb_status: 'verified', wallet_address: ADDR.seller1 },
  { id: 2, legal_name: 'CoreTech Apparel', country: 'Pakistan', kyb_status: 'verified', wallet_address: ADDR.seller2 },
  { id: 3, legal_name: 'GlobalMart', country: 'United Kingdom', kyb_status: 'verified', wallet_address: ADDR.buyer1 },
  { id: 4, legal_name: 'GlobalMart II', country: 'United Arab Emirates', kyb_status: 'verified', wallet_address: ADDR.buyer2 },
]

const BUYER_OPTIONS = BUSINESSES.filter((b) => b.id >= 3).map((b) => ({ id: b.id, legal_name: b.legal_name, country: b.country }))

// ---- Credit score builder -----------------------------------------------
function score(scoreVal, band, features) {
  return {
    score: scoreVal,
    risk_band: band,
    model_version: 'v3 (xgboost-2026.09)',
    suggested_terms: { escrow_pct: band === 'low' ? 30 : band === 'medium' ? 60 : 100, requires_review: band !== 'low', min_documents: band === 'low' ? 2 : 3 },
    top_features: features,
  }
}

const FEATS_LOW = [
  { name: 'on_time_rate', label: 'Buyer on-time payment rate', impact: 14.2, direction: 'increase' },
  { name: 'past_orders', label: 'Buyer historical order count', impact: 8.1, direction: 'increase' },
  { name: 'buyer_country_risk', label: 'Buyer country risk index', impact: 5.0, direction: 'increase' },
  { name: 'fx_volatility', label: 'FX volatility over window', impact: -2.3, direction: 'decrease' },
  { name: 'doc_discrepancy_count', label: 'Document discrepancies', impact: -1.1, direction: 'decrease' },
]
const FEATS_MED = [
  { name: 'buyer_avg_days_to_pay', label: 'Avg days buyer takes to pay', impact: -11.4, direction: 'decrease' },
  { name: 'invoice_to_avg_ratio', label: 'Invoice vs historical avg', impact: -6.8, direction: 'decrease' },
  { name: 'payment_term_days', label: 'Payment term length', impact: -4.2, direction: 'decrease' },
  { name: 'on_time_rate', label: 'Buyer on-time payment rate', impact: 7.5, direction: 'increase' },
  { name: 'fx_volatility', label: 'FX volatility over window', impact: -3.1, direction: 'decrease' },
]
const FEATS_HIGH = [
  { name: 'buyer_country_risk', label: 'Buyer country risk index', impact: -19.7, direction: 'decrease' },
  { name: 'doc_discrepancy_count', label: 'Document discrepancies', impact: -15.2, direction: 'decrease' },
  { name: 'invoice_to_avg_ratio', label: 'Invoice vs historical avg', impact: -9.6, direction: 'decrease' },
  { name: 'past_orders', label: 'Buyer historical order count', impact: 3.4, direction: 'increase' },
  { name: 'amount_usd', label: 'Order amount (USD)', impact: -5.1, direction: 'decrease' },
]

function docCheck(result, disc) {
  return { result, checked_at: iso(-120), discrepancies: disc }
}

function detail(order, extra) {
  return {
    business_seller: BUSINESSES.find((b) => b.id === order.seller_id),
    business_buyer: BUSINESSES.find((b) => b.id === order.buyer_id),
    ...extra,
  }
}

// ---- Escrow factory ------------------------------------------------------
const ESCROW_STEP = { Created: 0, Funded: 1, ShipmentConfirmed: 2, Released: 3, Refunded: 3, Disputed: 2 }
function escrow(orderId, state, amount) {
  return {
    contract_address: ADDR.escrow,
    amount,
    token: 'sUSD',
    state,
    buyer_wallet: ADDR.buyer1,
    seller_wallet: ADDR.seller1,
    tx_fund: state === 'Created' ? null : fakeHash('fund' + orderId),
    tx_release: state === 'Released' ? fakeHash('release' + orderId) : null,
    explorer_url: `sim://tx/${fakeHash('fund' + orderId).slice(2, 14)}`,
  }
}

function shipmentEvents(orderId, count) {
  const types = ['dispatch', 'in_transit', 'delivery']
  return types.slice(0, count).map((event_type, i) => ({
    id: i + 1,
    event_type,
    received_at: iso(-100 + i * 40),
    payload: { carrier: 'OceanBridge Logistics', location: ['Karachi Port', 'Colombo Transit', 'Felixstowe'][i] || 'In transit', weight_kg: 1200 },
  }))
}

function agentAction(id, orderId, action, decision, reason, checks, tx = null) {
  return { id, order_id: orderId, action, decision, reason, policy_checks: checks, tx_hash: tx, timestamp: iso(-60 + id) }
}

const PC = {
  kill_switch: { rule: 'kill_switch', passed: true, detail: 'Agent is active (kill switch off)' },
  docs: { rule: 'documents_valid', passed: true, detail: 'Doc check result = pass' },
  docsFail: { rule: 'documents_valid', passed: false, detail: 'Doc check = mismatch, 2 discrepancies' },
  anomaly: { rule: 'no_anomaly', passed: true, detail: 'No anomaly flags raised' },
  threshold: { rule: 'reviewer_threshold_score', passed: true, detail: 'score 82.5 ≥ 60' },
  thresholdFail: { rule: 'reviewer_threshold_score', passed: false, detail: 'score 41.0 < 60 → escalate' },
  shipment: { rule: 'shipment_confirmed', passed: true, detail: 'delivery event received' },
  shipmentFail: { rule: 'shipment_confirmed', passed: false, detail: 'No delivery evidence yet → hold' },
  limit: { rule: 'auto_release_limit', passed: true, detail: '18000 ≤ 25000' },
  limitFail: { rule: 'auto_release_limit', passed: false, detail: '42000 > 25000 → human release' },
}

// ---- Order fixtures ------------------------------------------------------
// Each entry: summary row (list shape) + detail (nested).
const ORDERS = [
  {
    id: 1, seller_id: 1, buyer_id: 3, seller_name: 'Ayesha Textiles', buyer_name: 'GlobalMart',
    goods: 'Cotton bed linens', quantity: 500, amount: 18000.0, currency: 'USD',
    payment_term_days: 30, ship_by: '2026-11-01', status: 'settled', created_at: iso(-9000),
    risk_band: 'low', score: 82.5, escrow_state: 'Released',
    _d: {
      documents: [
        { id: 1, type: 'invoice', file_name: 'invoice-1042.pdf', uploaded_at: iso(-9000) },
        { id: 2, type: 'packing_list', file_name: 'packing-1042.csv', uploaded_at: iso(-8990) },
        { id: 3, type: 'order_terms', file_name: 'terms.txt', uploaded_at: iso(-8985) },
      ],
      document_check: docCheck('pass', []),
      credit_score: score(82.5, 'low', FEATS_LOW),
      escrow: escrow(1, 'Released', 18000),
      shipment_events: shipmentEvents(1, 3),
      agent_actions: [
        agentAction(1, 1, 'approve_terms', 'approve', 'Low risk buyer, clean documents — terms approved.', [PC.kill_switch, PC.docs, PC.anomaly, PC.threshold]),
        agentAction(2, 1, 'release_funds', 'release', 'Delivery confirmed and within auto-release limit. Funds released to seller.', [PC.kill_switch, PC.docs, PC.shipment, PC.limit], fakeHash('release1')),
      ],
      dispute: null,
      fx_note: { base: 'USD', quote: 'GBP', days: 30, rate: 0.7921, volatility_pct: 3.4, exposure_pct: 1.6, note: 'Modest GBP volatility; recommend 30-day forward cover on 50% of exposure.', source: 'cache' },
    },
  },
  {
    id: 2, seller_id: 1, buyer_id: 3, seller_name: 'Ayesha Textiles', buyer_name: 'GlobalMart',
    goods: 'Knitted sweaters (winter)', quantity: 1200, amount: 42000.0, currency: 'USD',
    payment_term_days: 45, ship_by: '2026-11-20', status: 'shipped', created_at: iso(-4300),
    risk_band: 'medium', score: 61.0, escrow_state: 'ShipmentConfirmed',
    _d: {
      documents: [
        { id: 4, type: 'invoice', file_name: 'invoice-1043.pdf', uploaded_at: iso(-4300) },
        { id: 5, type: 'packing_list', file_name: 'packing-1043.csv', uploaded_at: iso(-4290) },
      ],
      document_check: docCheck('mismatch', [
        { field: 'quantity', invoice_value: '1200', packing_list_value: '1000', severity: 'high', description: 'Invoice quantity does not match packing list.' },
        { field: 'amount', invoice_value: '42000', packing_list_value: '35000', severity: 'medium', description: 'Packing list total is lower than invoice.' },
      ]),
      credit_score: score(61.0, 'medium', FEATS_MED),
      escrow: escrow(2, 'ShipmentConfirmed', 42000),
      shipment_events: shipmentEvents(2, 3),
      agent_actions: [
        agentAction(3, 2, 'escalate', 'escalate', 'Amount exceeds auto-release limit and 2 doc discrepancies — escalated for human review.', [PC.kill_switch, PC.docsFail, PC.threshold, PC.limitFail]),
      ],
      dispute: null,
      fx_note: { base: 'USD', quote: 'GBP', days: 45, rate: 0.7902, volatility_pct: 6.1, exposure_pct: 3.0, note: 'Elevated volatility over the 45-day window; consider partial pre-payment.', source: 'live' },
    },
  },
  {
    id: 3, seller_id: 2, buyer_id: 4, seller_name: 'CoreTech Apparel', buyer_name: 'GlobalMart II',
    goods: 'Denim jackets', quantity: 800, amount: 26000.0, currency: 'USD',
    payment_term_days: 30, ship_by: '2026-12-05', status: 'disputed', created_at: iso(-2600),
    risk_band: 'high', score: 41.0, escrow_state: 'Disputed',
    _d: {
      documents: [
        { id: 6, type: 'invoice', file_name: 'invoice-1044.pdf', uploaded_at: iso(-2600) },
        { id: 7, type: 'packing_list', file_name: 'packing-1044.csv', uploaded_at: iso(-2590) },
      ],
      document_check: docCheck('fail', [
        { field: 'goods_description', invoice_value: 'Denim jackets', packing_list_value: 'Mixed apparel', severity: 'high', description: 'Description mismatch between invoice and packing list.' },
        { field: 'quantity', invoice_value: '800', packing_list_value: '650', severity: 'high', description: 'Short-shipment indicated by packing list.' },
        { field: 'ship_date', invoice_value: '2026-12-05', packing_list_value: '2026-12-18', severity: 'medium', description: 'Ship date discrepancy.' },
      ]),
      credit_score: score(41.0, 'high', FEATS_HIGH),
      escrow: escrow(3, 'Disputed', 26000),
      shipment_events: shipmentEvents(3, 2),
      agent_actions: [
        agentAction(4, 3, 'hold', 'hold', 'High risk band, failing document check and anomaly flags — funds held pending review.', [PC.kill_switch, PC.docsFail, PC.thresholdFail, PC.anomaly]),
      ],
      dispute: { id: 1, order_id: 3, raised_by: 'buyer', reason: 'Received 650 units against invoice for 800. Requesting partial refund.', status: 'open', assigned_reviewer_id: 6, resolution: null, notes: null, resolved_at: null },
      fx_note: { base: 'USD', quote: 'AED', days: 30, rate: 3.6725, volatility_pct: 1.2, exposure_pct: 0.5, note: 'AED is pegged to USD — FX exposure negligible.', source: 'cache' },
    },
  },
  {
    id: 4, seller_id: 1, buyer_id: 3, seller_name: 'Ayesha Textiles', buyer_name: 'GlobalMart',
    goods: 'Terry towels bulk', quantity: 2000, amount: 9500.0, currency: 'USD',
    payment_term_days: 15, ship_by: '2026-11-10', status: 'funded', created_at: iso(-1500),
    risk_band: 'low', score: 88.0, escrow_state: 'Funded',
    _d: {
      documents: [
        { id: 8, type: 'invoice', file_name: 'invoice-1045.pdf', uploaded_at: iso(-1500) },
        { id: 9, type: 'order_terms', file_name: 'terms.txt', uploaded_at: iso(-1495) },
      ],
      document_check: docCheck('pass', []),
      credit_score: score(88.0, 'low', FEATS_LOW),
      escrow: escrow(4, 'Funded', 9500),
      shipment_events: [],
      agent_actions: [
        agentAction(5, 4, 'approve_terms', 'approve', 'Trusted repeat buyer, terms approved. Awaiting shipment evidence before release.', [PC.kill_switch, PC.docs, PC.anomaly, PC.threshold]),
      ],
      dispute: null,
      fx_note: { base: 'USD', quote: 'GBP', days: 15, rate: 0.7935, volatility_pct: 2.1, exposure_pct: 0.9, note: 'Short window, low volatility.', source: 'cache' },
    },
  },
  {
    id: 5, seller_id: 1, buyer_id: 3, seller_name: 'Ayesha Textiles', buyer_name: 'GlobalMart',
    goods: 'Ladies handbags', quantity: 350, amount: 21000.0, currency: 'USD',
    payment_term_days: 30, ship_by: '2026-11-25', status: 'awaiting_funding', created_at: iso(-720),
    risk_band: 'medium', score: 66.0, escrow_state: 'Created',
    _d: {
      documents: [
        { id: 10, type: 'invoice', file_name: 'invoice-1046.pdf', uploaded_at: iso(-720) },
        { id: 11, type: 'packing_list', file_name: 'packing-1046.csv', uploaded_at: iso(-710) },
      ],
      document_check: docCheck('pass', []),
      credit_score: score(66.0, 'medium', FEATS_MED),
      escrow: escrow(5, 'Created', 21000),
      shipment_events: [],
      agent_actions: [
        agentAction(6, 5, 'approve_terms', 'approve', 'Score above threshold; escrow created, awaiting buyer funding.', [PC.kill_switch, PC.docs, PC.anomaly, PC.threshold]),
      ],
      dispute: null,
      fx_note: { base: 'USD', quote: 'GBP', days: 30, rate: 0.7918, volatility_pct: 4.0, exposure_pct: 1.8, note: 'Standard cover recommended.', source: 'cache' },
    },
  },
  {
    id: 6, seller_id: 2, buyer_id: 4, seller_name: 'CoreTech Apparel', buyer_name: 'GlobalMart II',
    goods: 'Sports jerseys', quantity: 1500, amount: 33000.0, currency: 'USD',
    payment_term_days: 60, ship_by: '2026-12-15', status: 'scored', created_at: iso(-300),
    risk_band: 'high', score: 48.0, escrow_state: null,
    _d: {
      documents: [
        { id: 12, type: 'invoice', file_name: 'invoice-1047.pdf', uploaded_at: iso(-300) },
      ],
      document_check: docCheck('mismatch', [
        { field: 'incoterms', invoice_value: 'FOB Karachi', order_terms_value: 'CIF London', severity: 'medium', description: 'Incoterms differ between invoice and order terms.' },
      ]),
      credit_score: score(48.0, 'high', FEATS_HIGH),
      escrow: null,
      shipment_events: [],
      agent_actions: [
        agentAction(7, 6, 'escalate', 'escalate', 'High risk score below threshold and long payment terms — escalated to reviewer.', [PC.kill_switch, PC.docsFail, PC.thresholdFail, PC.limitFail]),
      ],
      dispute: null,
      fx_note: { base: 'USD', quote: 'AED', days: 60, rate: 3.6725, volatility_pct: 1.3, exposure_pct: 0.6, note: 'AED pegged; watch 60-day receivable risk.', source: 'cache' },
    },
  },
  {
    id: 7, seller_id: 1, buyer_id: 3, seller_name: 'Ayesha Textiles', buyer_name: 'GlobalMart',
    goods: 'Bed sheet sets', quantity: 900, amount: 15500.0, currency: 'USD',
    payment_term_days: 30, ship_by: '2026-12-01', status: 'released', created_at: iso(-1000),
    risk_band: 'low', score: 79.0, escrow_state: 'Released',
    _d: {
      documents: [
        { id: 13, type: 'invoice', file_name: 'invoice-1048.pdf', uploaded_at: iso(-1000) },
        { id: 14, type: 'packing_list', file_name: 'packing-1048.csv', uploaded_at: iso(-990) },
      ],
      document_check: docCheck('pass', []),
      credit_score: score(79.0, 'low', FEATS_LOW),
      escrow: escrow(7, 'Released', 15500),
      shipment_events: shipmentEvents(7, 3),
      agent_actions: [
        agentAction(8, 7, 'release_funds', 'release', 'All policy checks passed — released to seller.', [PC.kill_switch, PC.docs, PC.shipment, PC.threshold, PC.limit], fakeHash('release7')),
      ],
      dispute: null,
      fx_note: { base: 'USD', quote: 'GBP', days: 30, rate: 0.7921, volatility_pct: 3.4, exposure_pct: 1.5, note: 'Nominal exposure.', source: 'cache' },
    },
  },
  {
    id: 8, seller_id: 1, buyer_id: 3, seller_name: 'Ayesha Textiles', buyer_name: 'GlobalMart',
    goods: 'Curtain fabric rolls', quantity: 200, amount: 7200.0, currency: 'USD',
    payment_term_days: 20, ship_by: '2026-11-28', status: 'draft', created_at: iso(-90),
    risk_band: null, score: null, escrow_state: null,
    _d: {
      documents: [{ id: 15, type: 'invoice', file_name: 'invoice-1049.pdf', uploaded_at: iso(-90) }],
      document_check: null,
      credit_score: null,
      escrow: null,
      shipment_events: [],
      agent_actions: [],
      dispute: null,
      fx_note: { base: 'USD', quote: 'GBP', days: 20, rate: 0.7930, volatility_pct: 2.7, exposure_pct: 1.1, note: 'Awaiting order confirmation.', source: 'cache' },
    },
  },
  {
    id: 9, seller_id: 2, buyer_id: 4, seller_name: 'CoreTech Apparel', buyer_name: 'GlobalMart II',
    goods: 'Winter scarves', quantity: 3000, amount: 12800.0, currency: 'USD',
    payment_term_days: 30, ship_by: '2026-12-10', status: 'docs_checked', created_at: iso(-45),
    risk_band: null, score: null, escrow_state: null,
    _d: {
      documents: [
        { id: 16, type: 'invoice', file_name: 'invoice-1050.pdf', uploaded_at: iso(-45) },
        { id: 17, type: 'packing_list', file_name: 'packing-1050.csv', uploaded_at: iso(-40) },
      ],
      document_check: docCheck('mismatch', [
        { field: 'total_weight', invoice_value: '1200kg', packing_list_value: '1100kg', severity: 'low', description: 'Minor weight rounding difference.' },
      ]),
      credit_score: null,
      escrow: null,
      shipment_events: [],
      agent_actions: [],
      dispute: null,
      fx_note: { base: 'USD', quote: 'AED', days: 30, rate: 3.6725, volatility_pct: 1.1, exposure_pct: 0.4, note: 'Pegged currency.', source: 'cache' },
    },
  },
  {
    id: 10, seller_id: 1, buyer_id: 3, seller_name: 'Ayesha Textiles', buyer_name: 'GlobalMart',
    goods: 'Upholstery textile', quantity: 640, amount: 58000.0, currency: 'USD',
    payment_term_days: 60, ship_by: '2027-01-05', status: 'rejected', created_at: iso(-8000),
    risk_band: 'high', score: 22.0, escrow_state: null,
    _d: {
      documents: [{ id: 18, type: 'invoice', file_name: 'invoice-1041.pdf', uploaded_at: iso(-8000) }],
      document_check: docCheck('fail', [
        { field: 'buyer_name', invoice_value: 'GlobalMart Ltd', packing_list_value: 'Global Holdings', severity: 'high', description: 'Counterparty name mismatch — possible fraud.' },
      ]),
      credit_score: score(22.0, 'high', FEATS_HIGH),
      escrow: null,
      shipment_events: [],
      agent_actions: [
        agentAction(9, 10, 'reject', 'reject', 'Anomaly flags + failing documents + very low score — order rejected.', [PC.docsFail, PC.thresholdFail, PC.anomaly]),
      ],
      dispute: null,
      fx_note: { base: 'USD', quote: 'GBP', days: 60, rate: 0.7902, volatility_pct: 6.5, exposure_pct: 4.0, note: 'High exposure over long window.', source: 'cache' },
    },
  },
]

function orderRow(o) {
  const { _d, ...row } = o
  return row
}

// ---- Disputes ------------------------------------------------------------
const DISPUTES = [ORDERS[2]._d.dispute]

// ---- Audit trail (hash-linked chain) ------------------------------------
function buildAudit() {
  const GENESIS = '0x' + '0'.repeat(64)
  const rows = []
  const seed = [
    [1, 'order_created', 'system'],
    [1, 'documents_checked', 'agent'],
    [1, 'score_computed', 'agent'],
    [1, 'escrow_created', 'agent'],
    [1, 'escrow_funded', 'buyer'],
    [1, 'shipment_confirmed', 'agent'],
    [1, 'funds_released', 'agent'],
    [2, 'order_created', 'system'],
    [2, 'escrow_funded', 'buyer'],
    [3, 'order_created', 'system'],
    [3, 'score_computed', 'agent'],
    [3, 'dispute_raised', 'buyer'],
    [3, 'agent_hold', 'agent'],
    [5, 'escrow_created', 'agent'],
    [6, 'score_computed', 'agent'],
    [6, 'agent_escalate', 'agent'],
    [7, 'funds_released', 'agent'],
    [10, 'order_rejected', 'agent'],
  ]
  let prev = GENESIS
  seed.forEach(([orderId, action, actor], i) => {
    const ts = iso(-9500 + i * 180)
    const data_hash = fakeHash(`data-${orderId}-${action}-${i}`)
    const entry_hash = fakeHash(`entry-${prev}-${data_hash}-${i}`)
    const o = ORDERS.find((x) => x.id === orderId)
    rows.push({
      id: i + 1,
      order_id: orderId,
      order_ref: `#${String(orderId).padStart(5, '0')} · ${o ? o.goods : 'System'}`,
      action,
      actor,
      data_hash,
      previous_hash: prev,
      entry_hash,
      tx_hash: /release|fund|created|shipment|dispute/.test(action) ? fakeHash('tx' + i) : null,
      timestamp: ts,
      _tampered: false,
    })
    prev = entry_hash
  })
  return rows
}
const AUDIT = buildAudit()

// ---- Reports -------------------------------------------------------------
function reportsSummary(dateFrom, dateTo) {
  const inRange = (s) => (!dateFrom || s.created_at >= dateFrom) && (!dateTo || s.created_at <= dateTo + 'T23:59:59Z')
  const orders = ORDERS.filter((o) => inRange(o))
  const settled = orders.filter((o) => o.status === 'settled' || o.status === 'released')
  const disputes = orders.filter((o) => o.status === 'disputed')
  const scored = orders.filter((o) => o.score != null)
  const by_status = orders.reduce((a, o) => ((a[o.status] = (a[o.status] || 0) + 1), a), {})
  const by_risk_band = orders.reduce((a, o) => { const b = o.risk_band || 'unrated'; a[b] = (a[b] || 0) + 1; return a }, {})
  return {
    totals: {
      orders: orders.length,
      settled_value: settled.reduce((s, o) => s + o.amount, 0),
      released_count: settled.length,
      disputes: disputes.length,
      dispute_rate: orders.length ? +(disputes.length / orders.length).toFixed(3) : 0,
      avg_score: scored.length ? +(scored.reduce((s, o) => s + o.score, 0) / scored.length).toFixed(1) : 0,
    },
    by_status,
    by_risk_band,
    recent: orders.slice(0, 6).map(orderRow),
  }
}

// ---- Models, users, settings, health ------------------------------------
const MODELS = [
  { id: 3, version: 'v3 (xgboost-2026.09)', trained_on: '2026-09-18T00:00:00Z', is_active: true, metrics: { auc: 0.91, accuracy: 0.87, n_rows: 5000 } },
  { id: 2, version: 'v2 (xgboost-2026.06)', trained_on: '2026-06-30T00:00:00Z', is_active: false, metrics: { auc: 0.88, accuracy: 0.83, n_rows: 4200 } },
  { id: 1, version: 'v1 (logreg-baseline)', trained_on: '2026-03-12T00:00:00Z', is_active: false, metrics: { auc: 0.79, accuracy: 0.75, n_rows: 3000 } },
]

const USERS = Object.values(ACCOUNTS).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: 'active', created_at: iso(-40000 + u.id * 1000) }))

let SETTINGS = { auto_release_limit: 25000, kill_switch: false, reviewer_threshold_score: 60, max_release_per_order: 1, agent_state: 'active' }

let HEALTH = { status: 'ok', chain: 'simulated', models_loaded: true, version: '1.0.0' }

let liveTick = 0
function statsLive() {
  liveTick++
  const awaiting = ORDERS.filter((o) => ['scored', 'docs_checked'].includes(o.status)).length
  const openDisputes = DISPUTES.filter((d) => d.status === 'open').length
  const releasedToday = ORDERS.filter((o) => ['released', 'settled'].includes(o.status)).length
  return { orders_total: ORDERS.length, awaiting_review: awaiting, open_disputes: openDisputes, released_today: releasedToday, chain_mode: HEALTH.chain }
}

// ---- Role scoping --------------------------------------------------------
function scopedOrders(role, userId) {
  if (role === 'exporter') return ORDERS.filter((o) => o.seller_id === userId)
  if (role === 'buyer') return ORDERS.filter((o) => o.buyer_id === userId)
  return ORDERS // reviewer/admin see all
}

// ===========================================================================
// Router — resolve(method, path, {body}) -> value (throws notFound if unknown)
// ===========================================================================
export function resolve(method, path, ctx = {}) {
  const { body = {}, user = null } = ctx
  const p = path.split('?')[0]
  const q = parseQuery(path)

  // ---- auth
  if (p === '/api/auth/login' && method === 'POST') {
    const acct = ACCOUNTS[(body.email || '').toLowerCase()]
    if (!acct || body.password !== 'Password123!') throw new Error('Invalid email or password')
    return { access_token: mockToken(acct), refresh_token: mockRefresh(acct), role: acct.role, user: { id: acct.id, name: acct.name, email: acct.email, role: acct.role } }
  }
  if (p === '/api/auth/refresh' && method === 'POST') return { access_token: body.refresh_token || mockToken(ACCOUNTS['admin@coretech.io']) }
  if (p === '/api/auth/logout') return { ok: true }
  if (p === '/api/auth/register' && method === 'POST') return { id: 99, email: body.email, role: body.role }

  // ---- health / stats
  if (p === '/api/health') return HEALTH
  if (p === '/api/stats/live') return statsLive()

  // ---- businesses
  if (p === '/api/businesses/me') return BUSINESSES.find((b) => b.id === (user?.business_id || 1))
  if (p === '/api/businesses' && method === 'POST') return { id: 5, legal_name: body.legal_name, country: body.country, kyb_status: 'verified', wallet_address: ADDR.seller1 }
  if (p === '/api/businesses' && method === 'GET') return { businesses: body.role === 'buyer' ? BUYER_OPTIONS : BUYER_OPTIONS }

  // ---- orders
  if (p === '/api/orders' && method === 'GET') {
    let rows = scopedOrders(user?.role || 'admin', user?.business_id || 1).map(orderRow)
    if (q.status) rows = rows.filter((o) => o.status === q.status)
    return { orders: rows }
  }
  if (p === '/api/orders' && method === 'POST') {
    const id = ORDERS.length + 1
    const buyer = BUSINESSES.find((b) => b.id === Number(body.buyer_id)) || BUSINESSES[2]
    const seller = BUSINESSES.find((b) => b.id === (user?.business_id || 1)) || BUSINESSES[0]
    const o = {
      id, seller_id: seller.id, buyer_id: buyer.id, seller_name: seller.legal_name, buyer_name: buyer.legal_name,
      goods: body.goods, quantity: Number(body.quantity), amount: Number(body.amount), currency: body.currency || 'USD',
      payment_term_days: Number(body.payment_term_days), ship_by: body.ship_by, status: 'draft', created_at: new Date().toISOString(),
      risk_band: null, score: null, escrow_state: null,
      _d: { documents: [], document_check: null, credit_score: null, escrow: null, shipment_events: [], agent_actions: [], dispute: null, fx_note: { base: 'USD', quote: 'GBP', days: Number(body.payment_term_days) || 30, rate: 0.792, volatility_pct: 3.2, exposure_pct: 1.4, note: 'Pending scoring.', source: 'cache' } },
    }
    ORDERS.unshift(o)
    return orderRow(o)
  }
  const mDetail = p.match(/^\/api\/orders\/(\d+)$/)
  if (mDetail && method === 'GET') {
    const o = ORDERS.find((x) => x.id === Number(mDetail[1]))
    if (!o) throw new Error('Order not found')
    return { ...orderRow(o), ...o._d }
  }

  const mDocs = p.match(/^\/api\/orders\/(\d+)\/documents$/)
  if (mDocs && method === 'POST') {
    const o = ORDERS.find((x) => x.id === Number(mDocs[1]))
    const id = 100 + o._d.documents.length + 1
    const doc = { id, type: body.type || 'invoice', file_name: body.file_name || 'upload.pdf', uploaded_at: new Date().toISOString() }
    o._d.documents.push(doc)
    return { id: doc.id, type: doc.type, file_name: doc.file_name }
  }
  const mCheck = p.match(/^\/api\/orders\/(\d+)\/check-documents$/)
  if (mCheck && method === 'POST') {
    const o = ORDERS.find((x) => x.id === Number(mCheck[1]))
    if (!o._d.document_check) o._d.document_check = docCheck('pass', [])
    o._d.document_check.checked_at = new Date().toISOString()
    setStatus(o, 'docs_checked')
    return { ...o._d.document_check, checker: 'rules' }
  }
  const mScore = p.match(/^\/api\/orders\/(\d+)\/score$/)
  if (mScore && method === 'POST') {
    const o = ORDERS.find((x) => x.id === Number(mScore[1]))
    if (!o._d.document_check) o._d.document_check = docCheck('pass', [])
    const cs = score(74.5, 'medium', FEATS_MED)
    o._d.credit_score = cs
    o.score = cs.score
    o.risk_band = cs.risk_band
    setStatus(o, 'scored')
    return { ...cs, anomaly: { is_anomaly: false, flags: ['invoice 12% above buyer 90-day average'] } }
  }
  const mEcreate = p.match(/^\/api\/orders\/(\d+)\/escrow\/create$/)
  if (mEcreate && method === 'POST') {
    const o = ORDERS.find((x) => x.id === Number(mEcreate[1]))
    o._d.escrow = escrow(o.id, 'Created', o.amount)
    o.escrow_state = 'Created'
    return o._d.escrow
  }
  const mEfund = p.match(/^\/api\/orders\/(\d+)\/escrow\/fund$/)
  if (mEfund && method === 'POST') {
    const o = ORDERS.find((x) => x.id === Number(mEfund[1]))
    if (!o._d.escrow) o._d.escrow = escrow(o.id, 'Created', o.amount)
    o._d.escrow.state = 'Funded'
    o._d.escrow.tx_fund = body.tx_hash || fakeHash('fund' + o.id + Date.now())
    o._d.escrow.explorer_url = `sim://tx/${o._d.escrow.tx_fund.slice(2, 14)}`
    o.escrow_state = 'Funded'
    setStatus(o, 'funded')
    return o._d.escrow
  }
  const mAgent = p.match(/^\/api\/orders\/(\d+)\/agent\/run$/)
  if (mAgent && method === 'POST') {
    const o = ORDERS.find((x) => x.id === Number(mAgent[1]))
    if (SETTINGS.kill_switch) {
      const act = agentAction(900 + o.id, o.id, 'hold', 'hold', 'Kill switch engaged — agent paused, no action taken.', [{ ...PC.kill_switch, passed: false, detail: 'Kill switch ON' }])
      o._d.agent_actions.push(act)
      return { decision: 'hold', reason: act.reason, policy_checks: act.policy_checks, action: 'hold', tx_hash: null, agent_action_id: act.id }
    }
    const canRelease = o.escrow_state === 'ShipmentConfirmed' && (o.amount <= SETTINGS.auto_release_limit) && (o.score >= SETTINGS.reviewer_threshold_score) && (!o._d.document_check || o._d.document_check.result !== 'fail')
    let decision, reason, checks, action, tx = null
    if (canRelease) {
      decision = 'release'; action = 'release_funds'; tx = fakeHash('release' + o.id + Date.now())
      reason = 'All policy checks passed — funds released to seller.'
      checks = [PC.kill_switch, PC.docs, PC.shipment, PC.threshold, PC.limit]
      o.escrow_state = 'Released'; o._d.escrow && (o._d.escrow.state = 'Released'); setStatus(o, 'released')
      o._d.escrow && (o._d.escrow.tx_release = tx)
    } else if (o.amount > SETTINGS.auto_release_limit) {
      decision = 'escalate'; action = 'escalate'
      reason = 'Amount exceeds auto-release limit — escalated for human release.'
      checks = [PC.kill_switch, PC.shipment, { ...PC.limit, passed: false, detail: `${o.amount} > ${SETTINGS.auto_release_limit} → human release` }]
    } else {
      decision = 'hold'; action = 'hold'
      reason = 'No delivery evidence yet — funds held.'
      checks = [PC.kill_switch, { ...PC.shipment, passed: false, detail: 'No delivery event recorded' }]
    }
    const act = { id: 900 + o.id, order_id: o.id, action, decision, reason, policy_checks: checks, tx_hash: tx, timestamp: new Date().toISOString() }
    o._d.agent_actions.push(act)
    return { decision, reason, policy_checks: checks, action, tx_hash: tx, agent_action_id: act.id }
  }
  const mSimS = p.match(/^\/api\/orders\/(\d+)\/simulate\/shipment$/)
  if (mSimS && method === 'POST') {
    const o = ORDERS.find((x) => x.id === Number(mSimS[1]))
    const seq = body.event_type ? [body.event_type] : ['dispatch', 'in_transit', 'delivery']
    seq.forEach((event_type) => o._d.shipment_events.push({ id: o._d.shipment_events.length + 1, event_type, received_at: new Date().toISOString(), payload: { carrier: 'Simulated', location: 'Live sim', weight_kg: 1200 } }))
    if (seq.includes('delivery')) { o.escrow_state = 'ShipmentConfirmed'; o._d.escrow && (o._d.escrow.state = 'ShipmentConfirmed'); setStatus(o, 'shipped') }
    else setStatus(o, 'shipped')
    return { ack: true, event_id: o._d.shipment_events.length, agent_decision: 'observed shipment event' }
  }
  const mSimD = p.match(/^\/api\/orders\/(\d+)\/simulate\/dispute$/)
  if (mSimD && method === 'POST') {
    const o = ORDERS.find((x) => x.id === Number(mSimD[1]))
    const d = { id: DISPUTES.length + 1, order_id: o.id, raised_by: 'buyer', reason: body.reason || 'Simulated dispute raised for demo.', status: 'open', assigned_reviewer_id: 6, resolution: null, notes: null, resolved_at: null }
    DISPUTES.push(d); o._d.dispute = d; o.escrow_state = 'Disputed'; o._d.escrow && (o._d.escrow.state = 'Disputed'); setStatus(o, 'disputed')
    return d
  }
  const mDisp = p.match(/^\/api\/orders\/(\d+)\/disputes$/)
  if (mDisp && method === 'POST') {
    const o = ORDERS.find((x) => x.id === Number(mDisp[1]))
    const d = { id: DISPUTES.length + 1, order_id: o.id, raised_by: 'buyer', reason: body.reason || 'Dispute raised.', status: 'open', assigned_reviewer_id: 6, resolution: null, notes: null, resolved_at: null }
    DISPUTES.push(d); o._d.dispute = d; o.escrow_state = 'Disputed'; o._d.escrow && (o._d.escrow.state = 'Disputed'); setStatus(o, 'disputed')
    return d
  }

  const mResolve = p.match(/^\/api\/disputes\/(\d+)\/resolve$/)
  if (mResolve && method === 'POST') {
    const d = DISPUTES.find((x) => x.id === Number(mResolve[1]))
    d.status = 'resolved'; d.resolution = body.decision; d.notes = body.notes; d.resolved_at = new Date().toISOString()
    const o = ORDERS.find((x) => x.id === d.order_id)
    if (body.decision === 'release') { o.escrow_state = 'Released'; setStatus(o, 'resolved') }
    else if (body.decision === 'refund') { o.escrow_state = 'Refunded'; setStatus(o, 'resolved') }
    else setStatus(o, 'disputed')
    const entry = { id: AUDIT.length + 1, order_id: o.id, order_ref: `#${String(o.id).padStart(5, '0')} · ${o.goods}`, action: `dispute_resolved:${body.decision}`, actor: 'reviewer', data_hash: fakeHash('r' + o.id + Date.now()), previous_hash: AUDIT[AUDIT.length - 1].entry_hash, entry_hash: fakeHash('re' + o.id + Date.now()), tx_hash: fakeHash('rtx' + o.id), timestamp: new Date().toISOString(), _tampered: false }
    AUDIT.push(entry)
    return { dispute: d, audit_entry: { id: entry.id, entry_hash: entry.entry_hash, tx_hash: entry.tx_hash } }
  }

  // ---- fx
  if (p === '/api/fx/risk') return { base: q.base || 'USD', quote: q.quote || 'GBP', days: Number(q.days) || 30, rate: 0.7921, volatility_pct: 3.6, exposure_pct: 1.7, note: 'Moderate volatility; partial forward cover recommended for the payment window.', source: 'cache' }

  // ---- audit
  if (p === '/api/audit-trail/verify') {
    const broken = AUDIT.find((e) => e._tampered)
    return { valid: !broken, checked: AUDIT.length, broken_entry_id: broken ? broken.id : null }
  }
  if (p === '/api/audit-trail' && method === 'GET') {
    let entries = AUDIT.map((e) => ({ ...e }))
    if (q.order_id) entries = entries.filter((e) => e.order_id === Number(q.order_id))
    if (q.q) { const s = q.q.toLowerCase(); entries = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(s)) }
    if (q.date_from) entries = entries.filter((e) => e.timestamp >= q.date_from)
    if (q.date_to) entries = entries.filter((e) => e.timestamp <= q.date_to + 'T23:59:59Z')
    const limit = Number(q.limit) || 100
    const offset = Number(q.offset) || 0
    return { total: AUDIT.length, entries: entries.slice(offset, offset + limit) }
  }
  const mTamper = p.match(/^\/api\/audit-trail\/tamper\/(\d+)$/)
  if (mTamper && method === 'POST') { const e = AUDIT.find((x) => x.id === Number(mTamper[1])); e._tampered = true; e.entry_hash = fakeHash('TAMPERED' + Date.now()); return { ok: true } }

  // ---- reports
  if (p === '/api/reports/summary') return reportsSummary(q.date_from, q.date_to)

  // ---- admin users
  if (p === '/api/admin/users' && method === 'GET') return { users: USERS.map((u) => ({ ...u })) }
  const mUser = p.match(/^\/api\/admin\/users\/(\d+)$/)
  if (mUser && method === 'PATCH') { const u = USERS.find((x) => x.id === Number(mUser[1])); u.status = body.status; return { ...u } }

  // ---- models
  if (p === '/api/models' && method === 'GET') return { models: MODELS.map((m) => ({ ...m })) }
  if (p === '/api/models/retrain' && method === 'POST') {
    const v = `v${MODELS.length + 1} (retrain-${new Date().toISOString().slice(0, 10)})`
    MODELS.forEach((m) => (m.is_active = false))
    MODELS.unshift({ id: MODELS.length + 1, version: v, trained_on: new Date().toISOString(), is_active: true, metrics: { auc: +(0.89 + Math.random() * 0.03).toFixed(3), accuracy: +(0.85 + Math.random() * 0.04).toFixed(3), n_rows: 5000 } })
    return { job_id: 'job-' + Date.now(), status: 'completed', model_version: v, metrics: MODELS[0].metrics }
  }

  // ---- settings / agent
  if (p === '/api/admin/settings' && method === 'GET') return { ...SETTINGS }
  if (p === '/api/admin/settings' && method === 'PUT') { Object.assign(SETTINGS, body); SETTINGS.agent_state = SETTINGS.kill_switch ? 'paused' : 'active'; return { ...SETTINGS } }
  if (p === '/api/admin/agent/pause' && method === 'POST') { SETTINGS.kill_switch = true; SETTINGS.agent_state = 'paused'; return { agent_state: 'paused', kill_switch: true } }
  if (p === '/api/admin/agent/resume' && method === 'POST') { SETTINGS.kill_switch = false; SETTINGS.agent_state = 'active'; return { agent_state: 'active' } }

  throw new Error(`Fixture route not implemented: ${method} ${p}`)
}

function setStatus(o, status) {
  o.status = status
}
function parseQuery(path) {
  const i = path.indexOf('?')
  if (i === -1) return {}
  const out = {}
  new URLSearchParams(path.slice(i + 1)).forEach((v, k) => (out[k] = v))
  return out
}
function mockToken(acct) {
  const hdr = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const pl = btoa(JSON.stringify({ sub: acct.id, role: acct.role, exp: Math.floor(Date.now() / 1000) + 1800 }))
  return `${hdr}.${pl}.sig`
}
function mockRefresh(acct) {
  return `r.${btoa(JSON.stringify({ sub: acct.id, role: acct.role }))}.sig`
}

// Buyer list helper (spec has no dedicated endpoint — see report note).
export const FIXTURE_BUYERS = BUYER_OPTIONS
