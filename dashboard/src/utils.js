// src/utils.js — formatting + shared design constants
export const fmtMoney = (n, cur = 'USD') =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)

export const fmtNum = (n) => (n == null ? '—' : new Intl.NumberFormat('en-US').format(n))

export const fmtPct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`)

// Compact money for axis ticks / dense table cells: 1200 -> "$1.2k"
export const shortMoney = (n) => {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`
  return `${sign}$${Math.round(abs)}`
}


export function fmtDate(s, withTime = false) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d)) return s
  return withTime
    ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function timeAgo(s) {
  if (!s) return '—'
  const diff = (Date.now() - new Date(s).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export const truncateMid = (h, n = 8) => (h && h.length > n * 2 + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h || '—')

// ---- Status color map (per API_SPEC order status enum) --------------------
export const STATUS_META = {
  draft:            { label: 'Draft',            pill: 'bg-slate-500/15 text-slate-300 border-slate-400/30' },
  docs_checked:     { label: 'Docs Checked',     pill: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/30' },
  scored:           { label: 'Scored',           pill: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/30' },
  awaiting_funding: { label: 'Awaiting Funding', pill: 'bg-gold/15 text-gold border-gold/40' },
  funded:           { label: 'Funded',           pill: 'bg-blue-500/15 text-blue-300 border-blue-400/30' },
  shipped:          { label: 'Shipped',          pill: 'bg-teal-500/15 text-teal-300 border-teal-400/30' },
  released:         { label: 'Released',         pill: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  settled:          { label: 'Settled',          pill: 'bg-emerald-600/20 text-emerald-300 border-emerald-400/40' },
  disputed:         { label: 'Disputed',         pill: 'bg-red-500/15 text-red-300 border-red-400/30' },
  resolved:         { label: 'Resolved',         pill: 'bg-violet-500/15 text-violet-300 border-violet-400/30' },
  rejected:         { label: 'Rejected',         pill: 'bg-rose-600/20 text-rose-300 border-rose-400/40' },
}

export const BAND_META = {
  low:    { label: 'Low',    text: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-400/30', ring: '#34d399', stroke: '#34d399' },
  medium: { label: 'Medium', text: 'text-gold',        bg: 'bg-gold/15 border-gold/40',                ring: '#D4AF37', stroke: '#D4AF37' },
  high:   { label: 'High',   text: 'text-red-300',     bg: 'bg-red-500/15 border-red-400/30',          ring: '#f87171', stroke: '#f87171' },
}

export function bandFromScore(score) {
  if (score == null) return null
  if (score >= 70) return 'low'
  if (score >= 50) return 'medium'
  return 'high'
}

export const SEVERITY = {
  high:   { label: 'High',   cls: 'bg-red-500/15 text-red-300 border-red-400/30', row: 'border-l-red-500 bg-red-500/5' },
  medium: { label: 'Medium', cls: 'bg-gold/15 text-gold border-gold/40',          row: 'border-l-gold bg-gold/5' },
  low:    { label: 'Low',    cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30',  row: 'border-l-sky-400 bg-sky-500/5' },
}

// ---- Alert design tokens (cash_gap | shipment | funding | release | escalation)
export const ALERT_TYPE = {
  cash_gap:   { label: 'Cash gap',   icon: '▽' },
  shipment:   { label: 'Shipment',   icon: '➤' },
  funding:    { label: 'Funding',    icon: '$' },
  release:    { label: 'Release',    icon: '⇧' },
  escalation: { label: 'Escalation', icon: '↑' },
}

export const ALERT_SEVERITY = {
  info:     { dot: 'bg-sky-400', chip: 'bg-sky-500/15 text-sky-300 border-sky-400/30' },
  warning:  { dot: 'bg-gold',    chip: 'bg-gold/15 text-gold border-gold/40' },
  critical: { dot: 'bg-red-500', chip: 'bg-red-500/15 text-red-300 border-red-400/30' },
}

export const CHECK_META = {  pass:     { label: 'Passed',  cls: 'text-emerald-300', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  mismatch: { label: 'Mismatch', cls: 'text-gold',       chip: 'bg-gold/15 text-gold border-gold/40' },
  fail:     { label: 'Failed',  cls: 'text-red-300',     chip: 'bg-red-500/15 text-red-300 border-red-400/30' },
}

export const DECISION_META = {
  approve:  { icon: '✓', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30' },
  release:  { icon: '⇧', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30' },
  hold:     { icon: '⏸', cls: 'text-gold bg-gold/10 border-gold/30' },
  escalate: { icon: '↑', cls: 'text-amber-300 bg-amber-500/10 border-amber-400/30' },
  reject:   { icon: '✕', cls: 'text-red-300 bg-red-500/10 border-red-400/30' },
}

// ---- Chart.js palette ----------------------------------------------------
export const CHART_COLORS = {
  gold: '#D4AF37', navy: '#335B97', emerald: '#34d399', red: '#f87171',
  sky: '#38bdf8', violet: '#a78bfa', slate: '#64748b', teal: '#2dd4bf',
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for non-secure contexts
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch { return false }
  }
}

export function downloadCSV(filename, rows) {
  // rows: array of objects
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const esc = (v) => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
