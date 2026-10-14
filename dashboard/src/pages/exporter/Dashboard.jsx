import { Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { PageHeader } from '../../components/PageHeader'
import { StatCard } from '../../components/StatCard'
import { DataTable } from '../../components/DataTable'
import { StatusPill, BandPill } from '../../components/StatusPill'
import { EmptyState } from '../../components/EmptyState'
import { fmtMoney, fmtNum } from '../../utils'

const QUICK = [
  { to: '/cash-flow', icon: '▽', title: 'Cash Flow', text: '12-week forecast, cash-gap warnings and what-if scenarios.' },
  { to: '/copilot', icon: '✦', title: 'Copilot', text: 'Ask about receipts, gaps, risk scores or financing.' },
  { to: '/orders/new', icon: '＋', title: 'New Order', text: 'Create a trade and upload invoice, packing list and terms.' },
  { to: '/payments', icon: '$', title: 'Payments', text: 'Settlement ledger with escrow releases and CSV export.' },
]

export function Dashboard() {
  const { data: biz } = useAsync(() => api.myBusiness().catch(() => null), [])
  const { data: report, loading: reportLoading } = useAsync(() => api.reportsSummary({}), [])
  const { data: ordersData, loading: ordersLoading } = useAsync(() => api.listOrders({}), [])
  const { data: flow, loading: flowLoading } = useAsync(
    () => (biz?.id ? api.cashflow(biz.id, { weeks: 12 }).catch(() => null) : Promise.resolve(null)),
    [biz?.id],
  )

  const totals = report?.totals || {}
  const orders = (ordersData?.orders || []).slice(0, 5)
  const gapWeeks = flow?.gap_weeks

  const columns = [
    {
      key: 'goods', header: 'Order', render: (o) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-100">{o.goods}</div>
          <div className="truncate text-xs text-slate-500">#{String(o.id).padStart(5, '0')} · {o.buyer_name}</div>
        </div>
      ),
    },
    { key: 'amount', header: 'Value', align: 'right', render: (o) => <span className="font-semibold tabular-nums text-white">{fmtMoney(o.amount, o.currency)}</span> },
    { key: 'status', header: 'Status', render: (o) => <StatusPill status={o.status} /> },
    { key: 'risk_band', header: 'Risk', render: (o) => <BandPill band={o.risk_band} /> },
    { key: 'open', header: '', align: 'right', render: (o) => <Link to={`/orders/${o.id}`} className="btn-ghost btn-sm">Open →</Link> },
  ]

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={biz ? `${biz.legal_name} · settlement and cash snapshot` : 'Your trade finance snapshot'}
        actions={<Link to="/orders" className="btn-ghost">All orders →</Link>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders" value={fmtNum(totals.orders)} icon="▣" tone="gold" loading={reportLoading} />
        <StatCard label="Settled value" value={fmtMoney(totals.settled_value, 'USD')} icon="$" tone="green" loading={reportLoading} />
        <StatCard
          label="Cash gap weeks"
          value={gapWeeks == null ? '—' : fmtNum(gapWeeks)}
          icon="▽"
          tone={gapWeeks > 0 ? 'red' : 'navy'}
          loading={flowLoading}
          hint={flow ? `Lowest ${fmtMoney(flow.lowest_projected_balance)} · ${flow.lowest_week}` : 'No forecast yet'}
        />
        <StatCard label="Avg credit score" value={totals.avg_score != null ? Math.round(totals.avg_score) : '—'} icon="◎" tone="violet" loading={reportLoading} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK.map((q) => (
          <Link key={q.to} to={q.to} className="card-pad group flex items-start gap-3 transition hover:border-gold/40">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-lg text-gold">{q.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white group-hover:text-gold">{q.title}</span>
              <span className="mt-0.5 block text-xs text-slate-400">{q.text}</span>
            </span>
          </Link>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={orders}
        loading={ordersLoading}
        searchable={false}
        toolbar={<span className="section-title">Recent orders</span>}
        empty={<EmptyState title="No orders yet" description="Create your first order to see it here." action={<Link to="/orders/new" className="btn-gold btn-sm">Create order</Link>} />}
      />
    </div>
  )
}

export default Dashboard
