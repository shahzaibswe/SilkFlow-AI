import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { PageHeader } from '../../components/PageHeader'
import { StatCard } from '../../components/StatCard'
import { StatusPill, BandPill } from '../../components/StatusPill'
import { EmptyState } from '../../components/EmptyState'
import { fmtMoney, fmtNum, fmtDate } from '../../utils'

// What the buyer still needs to do on a given order.
function pendingAction(o) {
  if (o.status === 'awaiting_funding' || o.escrow_state === 'Created') return { label: 'Fund escrow', tone: 'gold' }
  if (o.status === 'scored' && !o.escrow_state) return { label: 'Accept terms', tone: 'gold' }
  if (o.status === 'funded') return { label: 'Awaiting shipment', tone: 'sky' }
  if (o.status === 'shipped') return { label: 'Confirm receipt', tone: 'green' }
  if (o.status === 'disputed') return { label: 'In review', tone: 'red' }
  return null
}

const TONE_CLS = {
  gold: 'border-gold/40 bg-gold/15 text-gold',
  green: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300',
  sky: 'border-sky-400/30 bg-sky-500/15 text-sky-300',
  red: 'border-red-400/30 bg-red-500/15 text-red-300',
}

export function Inbox() {
  const [filter, setFilter] = useState('all')
  const { data, loading } = useAsync(() => api.listOrders({}), [])
  const orders = data?.orders || []

  const actionables = orders.map((o) => ({ o, a: pendingAction(o) })).filter((x) => x.a)
  const openValue = actionables.reduce((s, x) => s + x.o.amount, 0)

  const shown = filter === 'action' ? actionables.map((x) => x.o) : orders

  return (
    <div>
      <PageHeader title="Order inbox" subtitle="Approve terms, fund escrow and confirm delivery for your suppliers." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Orders" value={fmtNum(orders.length)} icon="▣" tone="navy" loading={loading} />
        <StatCard label="Needs action" value={fmtNum(actionables.length)} icon="⚑" tone="gold" loading={loading} hint="Accept, fund or confirm" />
        <StatCard label="Open value" value={fmtMoney(openValue, 'USD')} icon="$" tone="green" loading={loading} />
      </div>

      <div className="mb-4 flex gap-2">
        <button className={`btn btn-sm ${filter === 'all' ? 'btn-gold' : 'btn-ghost'}`} onClick={() => setFilter('all')}>All orders</button>
        <button className={`btn btn-sm ${filter === 'action' ? 'btn-gold' : 'btn-ghost'}`} onClick={() => setFilter('action')}>Needs action</button>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card-pad skeleton h-28" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing here" description={filter === 'action' ? 'No orders are waiting on you right now.' : 'You have no orders yet.'} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((o) => {
            const a = pendingAction(o)
            return (
              <Link key={o.id} to={`/orders/${o.id}`} className="card-pad group transition hover:border-gold/40 hover:bg-navy-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-white">{o.goods}</p>
                    <p className="truncate text-xs text-slate-500">#{String(o.id).padStart(5, '0')} · {o.seller_name}</p>
                  </div>
                  {a ? (
                    <span className={`chip shrink-0 border text-[11px] ${TONE_CLS[a.tone]}`}>⚑ {a.label}</span>
                  ) : (
                    <StatusPill status={o.status} className="shrink-0" />
                  )}
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-extrabold tabular-nums text-white">{fmtMoney(o.amount, o.currency)}</span>
                    <BandPill band={o.risk_band} />
                  </div>
                  <span className="text-xs text-slate-500">Ship by {fmtDate(o.ship_by)}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Inbox
