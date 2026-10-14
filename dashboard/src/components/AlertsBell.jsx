// src/components/AlertsBell.jsx
// ---------------------------------------------------------------------------
// Navbar alert bell. Polls GET /api/alerts?unread=true&limit=1 every 30s for
// the unread count, lazily loads the 8 most recent alerts when opened and
// marks an alert read via POST /api/alerts/{id}/read.
// Renders nothing unless the alerts endpoint answers (200) — roles without
// alert access simply get no bell.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../auth'
import { useToast } from './Toast'
import { Spinner } from './Spinner'
import { timeAgo, ALERT_SEVERITY, ALERT_TYPE } from '../utils'

const POLL_MS = 30000
const LIST_LIMIT = 8

export function AlertsBell() {
  const { user } = useAuth()
  const toast = useToast()
  // null = not probed yet, true = endpoint answered, false = forbidden/absent
  const [available, setAvailable] = useState(null)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const refreshCount = useCallback(async () => {
    try {
      const d = await api.listAlerts({ unread: true, limit: 1 })
      setUnread(Number(d?.unread) || 0)
      setAvailable(true)
    } catch (e) {
      if (e.status === 403 || e.status === 404) setAvailable(false)
    }
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.listAlerts({ limit: LIST_LIMIT })
      setItems(d?.alerts || [])
      setUnread(Number(d?.unread) || 0)
      setAvailable(true)
    } catch (e) {
      if (e.status === 403 || e.status === 404) setAvailable(false)
    } finally {
      setLoading(false)
    }
  }, [])

  // Count on mount / login, then every 30s (paused while the tab is hidden).
  useEffect(() => {
    if (!user) { setAvailable(null); setUnread(0); setItems([]); return undefined }
    setAvailable(null)
    refreshCount()
    const id = setInterval(() => { if (!document.hidden) refreshCount() }, POLL_MS)
    return () => clearInterval(id)
  }, [user?.id, refreshCount])

  useEffect(() => { if (open) loadList() }, [open, loadList])

  const markRead = async (a) => {
    if (a.read_at) return
    setBusyId(a.id)
    try {
      const updated = await api.markAlertRead(a.id)
      setItems((xs) => xs.map((x) => (x.id === a.id ? { ...x, read_at: updated?.read_at || Date.now() / 1000 } : x)))
      setUnread((n) => Math.max(0, n - 1))
      refreshCount()
    } catch (e) {
      toast.error(e.message || 'Could not dismiss alert')
    } finally {
      setBusyId(null)
    }
  }

  if (available === false || !user) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-navy-800 text-slate-300 hover:border-white/20 hover:text-white"
        aria-label={`Alerts${unread ? ` (${unread} unread)` : ''}`}
      >
        <span className="text-base leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold leading-none text-navy-950">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-[min(92vw,22rem)] animate-fade-in rounded-xl border border-white/10 bg-navy-800 p-2 shadow-card">
            <div className="flex items-center justify-between border-b border-white/10 px-3 pb-2.5 pt-1">
              <span className="section-title">Alerts</span>
              <span className="text-[11px] text-slate-500">{unread ? `${unread} unread` : 'All caught up'}</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Spinner size={16} /> Loading alerts…</div>
            ) : items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-slate-500">No alerts yet.</p>
            ) : (
              <ul className="max-h-[24rem] overflow-y-auto">
                {items.map((a) => {
                  const sev = ALERT_SEVERITY[a.severity] || ALERT_SEVERITY.info
                  const type = ALERT_TYPE[a.type] || { label: a.type, icon: '•' }
                  const isRead = !!a.read_at
                  return (
                    <li key={a.id} className={`flex items-start gap-1.5 rounded-lg px-3 py-2.5 transition hover:bg-white/5 ${isRead ? 'opacity-55' : ''}`}>
                      <button onClick={() => markRead(a)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev.dot}`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={`chip border px-1.5 py-0 text-[10px] uppercase tracking-wider ${sev.chip}`}>{type.label}</span>
                            <span className="ml-auto shrink-0 text-[11px] text-slate-500">{timeAgo(a.created_at)}</span>
                          </span>
                          <span className="mt-1.5 block text-xs leading-snug text-slate-200">{a.message}</span>
                          <span className="mt-1 block text-[11px] text-slate-500">
                            {a.order_id != null ? <>Order #{String(a.order_id).padStart(5, '0')} · {isRead ? 'read' : 'click to mark read'}</> : (isRead ? 'Read' : 'Click to mark read')}
                          </span>
                        </span>
                        {busyId === a.id && <Spinner size={14} className="mt-1 shrink-0" />}
                      </button>
                      {a.order_id != null && (
                        <Link
                          to={`/orders/${a.order_id}`}
                          onClick={() => { markRead(a); setOpen(false) }}
                          className="btn-ghost btn-sm shrink-0"
                          title="Open order"
                        >
                          →
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="flex items-center justify-between border-t border-white/10 px-3 pb-1 pt-2">
              <span className="text-[10px] text-slate-600">Click an alert to mark it read</span>
              <button onClick={() => setOpen(false)} className="btn-ghost btn-sm">Close</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default AlertsBell
