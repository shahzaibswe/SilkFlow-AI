import { Link } from 'react-router-dom'
import api from '../../api'
import { usePoll } from '../../hooks'
import { PageHeader } from '../../components/PageHeader'
import { StatCard } from '../../components/StatCard'
import { StatusPill, BandPill } from '../../components/StatusPill'
import { Timeline } from '../../components/Timeline'
import { HashLink } from '../../components/HashLink'
import { EmptyState } from '../../components/EmptyState'
import { fmtMoney, fmtNum, fmtDate, DECISION_META } from '../../utils'

async function loadFeed() {
  const stats = await api.statsLive()
  const { orders = [] } = await api.listOrders({})
  const recent = [...orders].sort((a, b) => b.id - a.id).slice(0, 5)
  const details = await Promise.all(recent.map((o) => api.getOrder(o.id).catch(() => null)))
  const actions = details.filter(Boolean).flatMap((d) => (d.agent_actions || []).map((a) => ({ ...a, _order: d })))
  actions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  return { stats, recent, actions: actions.slice(0, 8) }
}

export function Feed() {
  const { data, loading, error } = usePoll(loadFeed, 5000, [])
  const stats = data?.stats
  const recent = data?.recent || []
  const actions = data?.actions || []

  const chainMode = stats?.chain_mode || 'simulated'

  const items = actions.map((a) => {
    const meta = DECISION_META[a.decision] || DECISION_META.hold
    return {
      id: `${a.id}-${a.order_id}`,
      title: `${a.action.replace('_', ' ')} · #${String(a.order_id).padStart(5, '0')}`,
      subtitle: a.reason,
      time: fmtDate(a.timestamp, true),
      tone: a.decision === 'release' || a.decision === 'approve' ? 'green' : a.decision === 'reject' ? 'red' : 'gold',
      icon: meta.icon,
      meta: (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400">{a._order.goods}</span>
          {a.tx_hash && <HashLink hash={a.tx_hash} label="tx" max={5} />}
        </div>
      ),
    }
  })

  return (
    <div>
      <PageHeader
        title="Live feed"
        subtitle="Real-time trade activity across the platform."
        actions={
          <>
            <span className={`chip border ${chainMode === 'live' ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300' : 'border-gold/40 bg-gold/15 text-gold'}`}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              chain: {chainMode}
            </span>
            <span className="chip border border-white/10 text-slate-400">auto-refresh 5s</span>
          </>
        }
      />

      {error && <div className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total orders" value={fmtNum(stats?.orders_total)} icon="▣" tone="navy" loading={loading} />
        <StatCard label="Awaiting review" value={fmtNum(stats?.awaiting_review)} icon="⚑" tone="gold" loading={loading} hint="scored / docs checked" />
        <StatCard label="Open disputes" value={fmtNum(stats?.open_disputes)} icon="⚠" tone="red" loading={loading} />
        <StatCard label="Released today" value={fmtNum(stats?.released_today)} icon="⇧" tone="green" loading={loading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card-pad">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Recent orders</h2>
            <Link to="/cases" className="text-xs font-semibold text-gold hover:underline">Case queue →</Link>
          </div>
          {recent.length === 0 && !loading ? (
            <EmptyState title="No orders" />
          ) : (
            <ul className="divide-y divide-white/5">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link to={`/cases/${o.id}`} className="flex items-center gap-3 py-3 transition hover:bg-white/[0.03]">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-100">{o.goods}</p>
                      <p className="truncate text-xs text-slate-500">#{String(o.id).padStart(5, '0')} · {o.buyer_name} · {fmtMoney(o.amount, o.currency)}</p>
                    </div>
                    <BandPill band={o.risk_band} />
                    <StatusPill status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-pad">
          <h2 className="mb-4 section-title">Latest agent actions</h2>
          <Timeline items={items} emptyText="No agent activity yet" />
        </div>
      </div>
    </div>
  )
}

export default Feed
