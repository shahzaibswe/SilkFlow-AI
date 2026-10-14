import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { PageHeader } from '../../components/PageHeader'
import { DataTable } from '../../components/DataTable'
import { StatusPill, BandPill } from '../../components/StatusPill'
import { EmptyState } from '../../components/EmptyState'
import { fmtMoney, fmtDate, STATUS_META } from '../../utils'

const ALL_STATUSES = Object.keys(STATUS_META)
const BANDS = [
  { key: '', label: 'All bands' },
  { key: 'low', label: 'Low risk' },
  { key: 'medium', label: 'Medium risk' },
  { key: 'high', label: 'High risk' },
]

function inDateRange(iso, from, to) {
  if (!iso) return false
  const d = iso.slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

export function Cases() {
  const [status, setStatus] = useState('')
  const [band, setBand] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data, loading } = useAsync(() => api.listOrders(status ? { status } : {}), [status])
  const all = data?.orders || []
  const rows = all.filter((o) => (!band || o.risk_band === band) && inDateRange(o.created_at, from, to))

  const columns = [
    {
      key: 'goods', header: 'Case', sortable: true,
      render: (o) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-100">{o.goods}</div>
          <div className="truncate text-xs text-slate-500">#{String(o.id).padStart(5, '0')} · {o.seller_name} → {o.buyer_name}</div>
        </div>
      ),
    },
    { key: 'amount', header: 'Value', sortable: true, align: 'right', render: (o) => <span className="font-semibold tabular-nums text-white">{fmtMoney(o.amount, o.currency)}</span> },
    { key: 'risk_band', header: 'Risk', sortable: true, render: (o) => <BandPill band={o.risk_band} /> },
    { key: 'score', header: 'Score', sortable: true, align: 'right', render: (o) => <span className={`tabular-nums font-semibold ${o.score == null ? 'text-slate-600' : o.score >= 70 ? 'text-emerald-300' : o.score >= 50 ? 'text-gold' : 'text-red-300'}`}>{o.score == null ? '—' : Math.round(o.score)}</span> },
    { key: 'status', header: 'Status', sortable: true, render: (o) => <StatusPill status={o.status} /> },
    { key: 'disputed', header: 'Queue', render: (o) => (o.status === 'disputed' || o.status === 'scored' || o.status === 'docs_checked' ? <span className="chip border border-gold/40 bg-gold/15 text-gold">Needs review</span> : <span className="text-xs text-slate-600">—</span>) },
    { key: 'created_at', header: 'Opened', sortable: true, align: 'right', render: (o) => <span className="text-xs text-slate-400">{fmtDate(o.created_at)}</span> },
    { key: 'open', header: '', align: 'right', render: (o) => <Link to={`/cases/${o.id}`} className="btn-ghost btn-sm">Review →</Link> },
  ]

  const clear = () => { setStatus(''); setBand(''); setFrom(''); setTo('') }

  return (
    <div>
      <PageHeader title="Case queue" subtitle="Every trade awaiting a human decision." />

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Sidebar filters */}
        <aside className="space-y-5">
          <div className="card-pad">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-title">Filters</h2>
              <button className="text-xs font-semibold text-gold hover:underline" onClick={clear}>Clear</button>
            </div>

            <label className="label">Status</label>
            <select className="input mb-3" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>

            <label className="label">Risk band</label>
            <select className="input mb-3" value={band} onChange={(e) => setBand(e.target.value)}>
              {BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>

            <label className="label">Opened from</label>
            <input type="date" className="input mb-3" value={from} onChange={(e) => setFrom(e.target.value)} />
            <label className="label">Opened to</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          <div className="card-pad">
            <h2 className="section-title mb-2">Quick views</h2>
            <div className="space-y-1.5">
              <button className="btn-ghost btn-sm w-full justify-start" onClick={() => { setStatus('disputed'); setBand(''); setFrom(''); setTo('') }}>Open disputes</button>
              <button className="btn-ghost btn-sm w-full justify-start" onClick={() => { setStatus(''); setBand('high'); setFrom(''); setTo('') }}>High-risk cases</button>
              <button className="btn-ghost btn-sm w-full justify-start" onClick={() => { setStatus('scored'); setBand(''); setFrom(''); setTo('') }}>Newly scored</button>
            </div>
          </div>
        </aside>

        {/* Table */}
        <div>
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            searchKeys={['goods', 'seller_name', 'buyer_name', 'status']}
            onRowClick={(o) => (window.location.href = `/cases/${o.id}`)}
            empty={<EmptyState title="No cases match" description="Try loosening the filters to see more of the queue." action={<button className="btn-ghost btn-sm" onClick={clear}>Reset filters</button>} />}
          />
        </div>
      </div>
    </div>
  )
}

export default Cases
