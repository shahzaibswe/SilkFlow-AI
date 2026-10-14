import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { StatCard } from '../../components/StatCard'
import { DataTable } from '../../components/DataTable'
import { StatusPill } from '../../components/StatusPill'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import { fmtMoney, fmtNum, fmtDate, downloadCSV } from '../../utils'

const PERIODS = [
  { label: 'All time', from: '', to: '' },
  { label: 'Last 30 days', from: () => daysAgo(30), to: () => today() },
  { label: 'Last 90 days', from: () => daysAgo(90), to: () => today() },
]

function today() { return new Date().toISOString().slice(0, 10) }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export function Payments() {
  const toast = useToast()
  const [period, setPeriod] = useState(0)
  const [exporting, setExporting] = useState(false)

  const dateFrom = PERIODS[period].from ? PERIODS[period].from() : undefined
  const dateTo = PERIODS[period].to ? PERIODS[period].to() : undefined

  const { data: settledData, loading } = useAsync(() => api.listOrders({ status: 'settled' }), [])
  const { data: report, loading: reportLoading } = useAsync(() => api.reportsSummary({ date_from: dateFrom, date_to: dateTo }), [period])

  const orders = settledData?.orders || []
  const totals = report?.totals || {}

  // Build a settlement ledger: prefer released+settled from the order rows, fall back to recent.
  const settledValue = totals.settled_value ?? orders.reduce((s, o) => s + o.amount, 0)

  const columns = [
    {
      key: 'goods', header: 'Order', sortable: true,
      render: (o) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-100">{o.goods}</div>
          <div className="truncate text-xs text-slate-500">#{String(o.id).padStart(5, '0')} · {o.buyer_name}</div>
        </div>
      ),
    },
    { key: 'amount', header: 'Settled', sortable: true, align: 'right', render: (o) => <span className="font-semibold tabular-nums text-emerald-300">{fmtMoney(o.amount, o.currency)}</span> },
    { key: 'status', header: 'Status', render: (o) => <StatusPill status={o.status} /> },
    { key: 'escrow_state', header: 'Escrow', render: (o) => <span className="chip border border-white/10 text-slate-300">{o.escrow_state || '—'}</span> },
    { key: 'created_at', header: 'Created', sortable: true, align: 'right', render: (o) => <span className="text-xs text-slate-400">{fmtDate(o.created_at)}</span> },
    { key: 'open', header: '', align: 'right', render: (o) => <Link to={`/orders/${o.id}`} className="btn-ghost btn-sm">Open →</Link> },
  ]

  const exportCSV = async () => {
    setExporting(true)
    try {
      // Merge order rows + report totals into a settlement ledger CSV built fully client-side.
      let rows = orders
      if (!rows.length && report?.recent) rows = report.recent
      const ledger = rows.map((o) => ({
        order_id: o.id,
        goods: o.goods,
        buyer: o.buyer_name,
        amount: o.amount,
        currency: o.currency,
        status: o.status,
        escrow_state: o.escrow_state || '',
        settled: ['settled', 'released'].includes(o.status) ? 'yes' : 'no',
        created_at: o.created_at,
      }))
      if (!ledger.length) { toast.warn('Nothing to export for this period'); return }
      downloadCSV(`silkflow-settlements-${today()}.csv`, ledger)
      toast.success(`Exported ${ledger.length} settlement${ledger.length === 1 ? '' : 's'}`)
    } finally {
      setExporting(false)
    }
  }

  const toolbar = (
    <>
      <select className="input w-auto py-1.5 text-sm" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
        {PERIODS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
      </select>
      <button className="btn-gold btn-sm" onClick={exportCSV} disabled={exporting}>
        {exporting && <Spinner size={14} className="text-navy-950" />}
        ⬇ Settlement summary (CSV)
      </button>
    </>
  )

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Settled trades and escrow releases across your account."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Settled value" value={fmtMoney(settledValue, 'USD')} icon="$" tone="green" loading={reportLoading} />
        <StatCard label="Released orders" value={fmtNum(totals.released_count ?? orders.length)} icon="⇧" tone="navy" loading={reportLoading} />
        <StatCard label="Total orders" value={fmtNum(totals.orders)} icon="▣" tone="gold" loading={reportLoading} hint={`${orders.length} settled`} />
        <StatCard label="Avg credit score" value={totals.avg_score != null ? Math.round(totals.avg_score) : '—'} icon="◎" tone="violet" loading={reportLoading} />
      </div>

      <DataTable
        columns={columns}
        data={orders}
        loading={loading}
        toolbar={toolbar}
        searchKeys={['goods', 'buyer_name']}
        empty={<EmptyState title="No settlements yet" description="Released and settled orders will appear here as escrow completes." />}
      />
    </div>
  )
}

export default Payments
