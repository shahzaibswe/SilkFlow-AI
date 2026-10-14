// src/api.js
// ---------------------------------------------------------------------------
// Thin API client. Talks to real /api endpoints via fetch, but when the env
// VITE_USE_FIXTURES is "1" every request is served from src/fixtures.js (which
// mirrors API_SPEC.md §3 shapes exactly). Toggling the flag is the ONLY change
// needed to move from fixtures to the live backend.
// ---------------------------------------------------------------------------
import { resolve as fixtureResolve } from './fixtures'

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === '1'
const LATENCY = Number(import.meta.env.VITE_FIXTURE_LATENCY || 260)

const LS_ACCESS = 'silkflow.access'
const LS_REFRESH = 'silkflow.refresh'

export const tokenStore = {
  get access() { return localStorage.getItem(LS_ACCESS) },
  get refresh() { return localStorage.getItem(LS_REFRESH) },
  set({ access_token, refresh_token }) {
    if (access_token) localStorage.setItem(LS_ACCESS, access_token)
    if (refresh_token) localStorage.setItem(LS_REFRESH, refresh_token)
  },
  clear() { localStorage.removeItem(LS_ACCESS); localStorage.removeItem(LS_REFRESH) },
}

// Emitted when auth definitively fails so <Auth/> can log the user out.
function emitUnauthorized() {
  window.dispatchEvent(new Event('silkflow:unauthorized'))
}

let refreshing = null
async function doRefresh() {
  if (!tokenStore.refresh) return false
  try {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokenStore.refresh }),
    })
    if (!r.ok) return false
    const d = await r.json()
    if (d.access_token) { localStorage.setItem(LS_ACCESS, d.access_token); return true }
    return false
  } catch { return false }
}

async function request(method, path, { body, formData, raw } = {}) {
  if (USE_FIXTURES) {
    await new Promise((r) => setTimeout(r, LATENCY))
    const user = currentUserFromToken()
    try {
      const val = fixtureResolve(method, path, { body: body || {}, user })
      if (raw) return { ok: true, status: 200, json: () => Promise.resolve(val) }
      return val
    } catch (e) {
      const err = new Error(e.message)
      err.status = 400
      throw err
    }
  }

  const headers = {}
  if (tokenStore.access && !formData) headers.Authorization = `Bearer ${tokenStore.access}`
  if (!formData && body !== undefined) headers['Content-Type'] = 'application/json'

  let res = await fetch(path, {
    method,
    headers,
    body: formData ? formData : body !== undefined ? JSON.stringify(body) : undefined,
  })

  // Auto-refresh once on 401 (except for the refresh endpoint itself)
  if (res.status === 401 && !path.includes('/auth/refresh') && tokenStore.refresh) {
    refreshing = refreshing || doRefresh()
    const ok = await refreshing
    refreshing = null
    if (ok) {
      res = await fetch(path, {
        method,
        headers: { ...headers, Authorization: `Bearer ${tokenStore.access}` },
        body: formData ? formData : body !== undefined ? JSON.stringify(body) : undefined,
      })
    } else {
      emitUnauthorized()
    }
  }
  if (res.status === 401) emitUnauthorized()
  if (raw) return res
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = j.detail || j.message || msg } catch {}
    const err = new Error(msg)
    err.status = res.status
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

function currentUserFromToken() {
  // Only meaningful in fixture mode; decode our mock JWT payload for role scoping.
  try {
    const t = tokenStore.access
    if (!t) return null
    const pl = JSON.parse(atob(t.split('.')[1]))
    return { id: pl.sub, role: pl.role, business_id: pl.sub }
  } catch { return null }
}

const qs = (obj) => {
  const p = new URLSearchParams()
  Object.entries(obj || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v) })
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ---- Typed helpers, one per spec endpoint --------------------------------
export const api = {
  // auth
  register: (b) => request('POST', '/api/auth/register', { body: b }),
  login: (b) => request('POST', '/api/auth/login', { body: b }),
  refresh: (b) => request('POST', '/api/auth/refresh', { body: b }),
  logout: () => request('POST', '/api/auth/logout'),

  // businesses
  createBusiness: (b) => request('POST', '/api/businesses', { body: b }),
  myBusiness: () => request('GET', '/api/businesses/me'),
  buyers: () => request('GET', '/api/businesses' + qs({ role: 'buyer' })),

  // orders
  listOrders: (f) => request('GET', '/api/orders' + qs(f)),
  getOrder: (id) => request('GET', `/api/orders/${id}`),
  createOrder: (b) => request('POST', '/api/orders', { body: b }),
  uploadDocument: (id, formData) => request('POST', `/api/orders/${id}/documents`, { formData }),
  checkDocuments: (id) => request('POST', `/api/orders/${id}/check-documents`),
  scoreOrder: (id) => request('POST', `/api/orders/${id}/score`),
  createEscrow: (id) => request('POST', `/api/orders/${id}/escrow/create`),
  fundEscrow: (id, b) => request('POST', `/api/orders/${id}/escrow/fund`, { body: b || {} }),
  runAgent: (id) => request('POST', `/api/orders/${id}/agent/run`),
  simulateShipment: (id, b) => request('POST', `/api/orders/${id}/simulate/shipment`, { body: b || {} }),
  simulateDispute: (id, b) => request('POST', `/api/orders/${id}/simulate/dispute`, { body: b || {} }),
  raiseDispute: (id, b) => request('POST', `/api/orders/${id}/disputes`, { body: b }),

  // disputes
  resolveDispute: (id, b) => request('POST', `/api/disputes/${id}/resolve`, { body: b }),

  // cash flow (SME copilot): exporter's own business; reviewer/admin may read any
  cashflow: (id, f) => request('GET', `/api/businesses/${id}/cashflow` + qs(f)),
  cashflowScenario: (id, b) => request('POST', `/api/businesses/${id}/cashflow/scenario`, { body: b }),

  // simulated financing offers (prototype only, never real credit)
  financingOptions: (id) => request('GET', `/api/orders/${id}/financing-options`),
  applyFinancing: (id, b) => request('POST', `/api/orders/${id}/financing-requests`, { body: b }),

  // alerts
  listAlerts: (f) => request('GET', '/api/alerts' + qs(f)),
  markAlertRead: (id) => request('POST', `/api/alerts/${id}/read`),

  // copilot chat + exporter business directory (reviewer/admin scoping)
  askCopilot: (b) => request('POST', '/api/copilot/ask', { body: b }),
  exporters: () => request('GET', '/api/businesses' + qs({ role: 'exporter' })),

  // fx
  fxRisk: (p) => request('GET', '/api/fx/risk' + qs(p)),

  // audit
  auditTrail: (f) => request('GET', '/api/audit-trail' + qs(f)),
  auditVerify: () => request('GET', '/api/audit-trail/verify'),
  auditTamper: (id) => request('POST', `/api/audit-trail/tamper/${id}`),

  // reports
  reportsSummary: (f) => request('GET', '/api/reports/summary' + qs(f)),

  // admin
  listUsers: () => request('GET', '/api/admin/users'),
  patchUser: (id, b) => request('PATCH', `/api/admin/users/${id}`, { body: b }),
  listModels: () => request('GET', '/api/models'),
  retrain: (b) => request('POST', '/api/models/retrain', { body: b || {} }),
  getSettings: () => request('GET', '/api/admin/settings'),
  putSettings: (b) => request('PUT', '/api/admin/settings', { body: b }),
  pauseAgent: () => request('POST', '/api/admin/agent/pause'),
  resumeAgent: () => request('POST', '/api/admin/agent/resume'),

  // misc
  health: () => request('GET', '/api/health'),
  statsLive: () => request('GET', '/api/stats/live'),
}

export default api
