import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { PageHeader } from '../../components/PageHeader'
import { DataTable } from '../../components/DataTable'
import { StatusPill, BandPill } from '../../components/StatusPill'
import { EmptyState } from '../../components/EmptyState'
import { fmtMoney, fmtDate, STATUS_META } from '../../utils'

export function OrdersList() {
  const [status, setStatus] = useState('')
  const { data, loading } = useAsync(() => api.listOrders(status ? { status } : {}), [status])
  const orders = data?.orders || []

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
    { key: 'quantity', header: 'Qty', sortable: true, align: 'right', render: (o) => <span className="tabular-nums text-slate-300">{o.quantity}</span> },
    { key: 'amount', header: 'Value', sortable: true, align: 'right', render: (o) => <span className="font-semibold tabular-nums text-white">{fmtMoney(o.amount, o.currency)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: (o) => o.status, render: (o) => <StatusPill status={o.status} /> },
    { key: 'risk_band', header: 'Risk', sortable: true, sortValue: (o) => (o.risk_band === 'low' ? 0 : o.risk_band === 'medium' ? 1 : o.risk_band === 'high' ? 2 : 3), render: (o) => <BandPill band={o.risk_band} /> },
    { key: 'score', header: 'Score', sortable: true, align: 'right', render: (o) => <span className={`tabular-nums font-semibold ${o.score == null ? 'text-slate-600' : o.score >= 70 ? 'text-emerald-300' : o.score >= 50 ? 'text-gold' : 'text-red-300'}`}>{o.score == null ? '—' : Math.round(o.score)}</span> },
    { key: 'created_at', header: 'Created', sortable: true, align: 'right', render: (o) => <span className="text-xs text-slate-400">{fmtDate(o.created_at)}</span> },
    {
      key: 'open', header: '', align: 'right',
      render: (o) => <Link to={`/orders/${o.id}`} className="btn-ghost btn-sm">Open →</Link>,
    },
  ]

  const toolbar = (
    <>
      <select className="input w-auto py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All statuses</option>
        {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <span className="text-xs text-slate-500">{orders.length} order{orders.length === 1 ? '' : 's'}</span>
    </>
  )

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Track every trade from draft to settlement."
        actions={<Link to="/orders/new" className="btn-gold">＋ New order</Link>}
      />
      <DataTable
        columns={columns}
        data={orders}
        loading={loading}
        toolbar={toolbar}
        searchKeys={['goods', 'buyer_name', 'status']}
        onRowClick={(o) => (window.location.href = `/orders/${o.id}`)}
        empty={<EmptyState title="No orders yet" description="Create your first order to get started with SilkFlow AI." action={<Link to="/orders/new" className="btn-gold btn-sm">Create order</Link>} />}
      />
    </div>
  )
}

export default OrdersList
