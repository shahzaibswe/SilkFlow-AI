import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useAuth } from '../../auth'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { HashLink } from '../../components/HashLink'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import { fmtDate } from '../../utils'

const GENESIS = '0x' + '0'.repeat(64)

export function AuditTrail() {
  const { role } = useAuth()
  const toast = useToast()
  const isAdmin = role === 'admin'

  const [params, setParams] = useState({ q: '', order_id: '' })
  const [draft, setDraft] = useState({ q: '', order_id: '' })
  const [verify, setVerify] = useState(null)
  const [busy, setBusy] = useState(null)

  const { data, loading, reload } = useAsync(
    () => api.auditTrail({ ...params, limit: 200 }),
    [params]
  )
  const entries = data?.entries || []

  const runVerify = async () => {
    setBusy('verify')
    try {
      const r = await api.auditVerify()
      setVerify(r)
      if (r.valid) toast.success(`Chain integrity verified — ${r.checked} entries valid`)
      else toast.error(`Broken link detected at entry #${r.broken_entry_id}`)
    } catch (ex) {
      toast.error(ex.message || 'Verification failed')
    } finally {
      setBusy(null)
    }
  }

  const tamper = async (id) => {
    setBusy(`tamper-${id}`)
    try {
      await api.auditTamper(id)
      toast.warn(`Entry #${id} hash mutated — re-verify to expose the break`)
      const r = await api.auditVerify()
      setVerify(r)
      await reload()
    } catch (ex) {
      toast.error(ex.message || 'Tamper failed')
    } finally {
      setBusy(null)
    }
  }

  const submitSearch = (e) => {
    e.preventDefault()
    setParams({ ...draft })
  }

  const brokenId = verify && !verify.valid ? verify.broken_entry_id : null

  return (
    <div>
      <PageHeader
        title="Audit trail"
        subtitle="Immutable, hash-linked ledger of every trade action."
        actions={
          <>
            <button className="btn-primary btn-sm" onClick={runVerify} disabled={busy === 'verify'}>
              {busy === 'verify' && <Spinner size={14} />}
              Verify integrity
            </button>
          </>
        }
      />

      {/* Verify banner */}
      {verify && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${verify.valid ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-red-400/30 bg-red-500/10 text-red-300'}`}>
          {verify.valid
            ? <>✓ All {verify.checked} entries are cryptographically consistent. Chain is intact.</>
            : <>⚠ Chain broken at entry #{verify.broken_entry_id}. {verify.checked} entries checked — downstream hashes no longer match.</>}
        </div>
      )}

      {/* Search */}
      <form onSubmit={submitSearch} className="card-pad mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <label className="label">Search</label>
          <input className="input" placeholder="action, actor, order, hash…" value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} />
        </div>
        <div className="w-40">
          <label className="label">Order ID</label>
          <input className="input" placeholder="e.g. 3" value={draft.order_id} onChange={(e) => setDraft((d) => ({ ...d, order_id: e.target.value }))} />
        </div>
        <button type="submit" className="btn-gold btn-sm">Filter</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => { setDraft({ q: '', order_id: '' }); setParams({ q: '', order_id: '' }) }}>Reset</button>
      </form>

      {loading ? (
        <div className="card-pad space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}</div>
      ) : entries.length === 0 ? (
        <EmptyState title="No audit entries" description="No ledger entries match the current filter." />
      ) : (
        <div className="relative ml-3 space-y-0 border-l-2 border-gold/20 pl-8">
          {entries.map((e, i) => {
            const broken = brokenId === e.id
            const prev = i === 0 ? GENESIS : entries[i - 1].entry_hash
            return (
              <div key={e.id} className="relative pb-6">
                {/* node */}
                <span className={`absolute -left-[41px] flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold ${broken ? 'border-red-500 bg-red-500 text-white' : 'border-gold bg-navy-900 text-gold'}`}>
                  {broken ? '!' : '•'}
                </span>
                <div className={`rounded-xl border p-4 transition ${broken ? 'border-red-400/40 bg-red-500/10 shadow-card' : 'border-white/10 bg-navy-800/80'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="chip border border-white/10 bg-navy-900/60 font-mono text-[11px] text-slate-300">#{String(e.id).padStart(4, '0')}</span>
                      <span className="text-sm font-semibold text-slate-100">{e.action.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-slate-500">by {e.actor}</span>
                    </div>
                    <span className="text-xs text-slate-500">{fmtDate(e.timestamp, true)}</span>
                  </div>

                  {e.order_id && (
                    <Link to={`/cases/${e.order_id}`} className="mt-1 inline-block text-xs font-medium text-gold hover:underline">
                      {e.order_ref || `Order #${e.order_id}`} →
                    </Link>
                  )}

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-navy-900/50 px-2.5 py-1.5">
                      <span className="text-[11px] text-slate-500">prev</span>
                      <HashLink hash={prev} max={6} />
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-navy-900/50 px-2.5 py-1.5">
                      <span className="text-[11px] text-slate-500">entry</span>
                      <HashLink hash={e.entry_hash} max={6} />
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-navy-900/50 px-2.5 py-1.5">
                      <span className="text-[11px] text-slate-500">data</span>
                      <HashLink hash={e.data_hash} max={6} />
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-navy-900/50 px-2.5 py-1.5">
                      <span className="text-[11px] text-slate-500">tx</span>
                      {e.tx_hash ? <HashLink hash={e.tx_hash} max={6} /> : <span className="text-[11px] text-slate-600">off-chain</span>}
                    </div>
                  </div>

                  {broken && <p className="mt-2 text-xs font-semibold text-red-300">⚠ This entry's stored hash no longer matches its recomputed value — the link is broken.</p>}

                  {isAdmin && (
                    <div className="mt-3 flex justify-end border-t border-white/5 pt-3">
                      <button className="btn-danger btn-sm" disabled={busy === `tamper-${e.id}`} onClick={() => tamper(e.id)}>
                        {busy === `tamper-${e.id}` && <Spinner size={14} />}
                        Tamper entry (demo)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default AuditTrail
