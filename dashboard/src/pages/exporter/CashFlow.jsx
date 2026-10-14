import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import '../../components/chartSetup'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { StatCard } from '../../components/StatCard'
import { EmptyState } from '../../components/EmptyState'
import { SkeletonCard } from '../../components/Skeleton'
import { Spinner } from '../../components/Spinner'
import {
  fmtMoney, fmtNum, timeAgo, shortMoney, CHART_COLORS, ALERT_SEVERITY, ALERT_TYPE,
} from '../../utils'

const HORIZONS = [
  { value: 8, label: '8 weeks' },
  { value: 12, label: '12 weeks' },
  { value: 16, label: '16 weeks' },
  { value: 26, label: '26 weeks' },
]

// Orders that still move cash in the forecast window.
const CLOSED = ['settled', 'released', 'rejected', 'resolved']

export function CashFlow() {
  const toast = useToast()
  const [weeks, setWeeks] = useState(12)
  const [orderId, setOrderId] = useState('')
  const [delay, setDelay] = useState(14)
  const [scenario, setScenario] = useState(null)
  const [scenarioBusy, setScenarioBusy] = useState(false)
  const [dismissed, setDismissed] = useState({})

  const { data: biz, loading: bizLoading } = useAsync(() => api.myBusiness(), [])
  const bizId = biz?.id ?? null

  const { data: flow, loading, error, reload } = useAsync(
    () => (bizId ? api.cashflow(bizId, { weeks }) : Promise.resolve(null)),
    [bizId, weeks],
  )
  const { data: ordersData } = useAsync(() => api.listOrders({}), [])

  const activeOrders = useMemo(
    () => (ordersData?.orders || []).filter((o) => !CLOSED.includes(o.status)),
    [ordersData],
  )

  // Default the what-if selector to the first active order.
  useEffect(() => {
    if (!orderId && activeOrders.length) setOrderId(String(activeOrders[0].id))
  }, [activeOrders, orderId])

  const alerts = useMemo(() => (flow?.alerts || []).filter((a) => !dismissed[a.id]), [flow, dismissed])
  const gapWeeks = useMemo(() => (flow?.weeks || []).filter((w) => w.gap), [flow])

  const chart = useMemo(() => {
    const rows = flow?.weeks || []
    const flags = rows.map((w) => !!w.gap)
    const datasets = [
      {
        type: 'line',
        label: 'Projected balance',
        data: rows.map((w) => w.projected_balance),
        yAxisID: 'y',
        borderWidth: 2,
        tension: 0.25,
        fill: false,
        pointRadius: flags.map((g) => (g ? 4 : 2)),
        pointHoverRadius: 5,
        pointBackgroundColor: flags.map((g) => (g ? CHART_COLORS.red : CHART_COLORS.gold)),
        pointBorderColor: flags.map((g) => (g ? CHART_COLORS.red : CHART_COLORS.gold)),
        segment: {
          borderColor: (c) => {
            const i0 = c.p0DataIndex ?? 0
            const i1 = c.p1DataIndex ?? i0
            return flags[i0] || flags[i1] ? CHART_COLORS.red : CHART_COLORS.gold
          },
        },
        order: 2,
      },
      {
        type: 'bar',
        label: 'Net weekly cash flow',
        data: rows.map((w) => w.receipts),
        yAxisID: 'y',
        backgroundColor: rows.map((w) => (w.receipts >= 0 ? 'rgba(52,211,153,0.55)' : 'rgba(248,113,113,0.45)')),
        borderColor: rows.map((w) => (w.receipts >= 0 ? CHART_COLORS.emerald : CHART_COLORS.red)),
        borderWidth: 1,
        borderRadius: 4,
        order: 3,
      },
    ]
    if (scenario?.forecast?.weeks?.length && scenario.forecast.weeks.length === rows.length) {
      datasets.unshift({
        type: 'line',
        label: `What-if: +${scenario.scenario.delay_days}d on order #${scenario.scenario.order_id}`,
        data: scenario.forecast.weeks.map((w) => w.projected_balance),
        yAxisID: 'y',
        borderColor: CHART_COLORS.violet,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25,
        fill: false,
        order: 1,
      })
    }
    return { labels: rows.map((w) => w.week_label), datasets }
  }, [flow, scenario])

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { boxWidth: 12, usePointStyle: true, font: { size: 11 } } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoney(c.raw)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true } },
      y: {
        grid: { color: 'rgba(255,255,255,0.06)' },
        ticks: { font: { size: 10 }, callback: (v) => shortMoney(v) },
      },
    },
  }), [])

  const runScenario = async () => {
    if (!bizId || !orderId) return
    setScenarioBusy(true)
    try {
      const d = await api.cashflowScenario(bizId, { order_id: Number(orderId), delay_days: Number(delay) })
      setScenario(d)
      // The scenario endpoint always recomputes its own horizon; align the base
      // chart so the dashed overlay maps week-for-week.
      const h = d?.forecast?.horizon_weeks
      if (h && h !== weeks) setWeeks(h)
    } catch (e) {
      toast.error(e.message || 'Scenario failed')
    } finally {
      setScenarioBusy(false)
    }
  }

  const dismissAlert = async (a) => {
    try {
      await api.markAlertRead(a.id)
      setDismissed((m) => ({ ...m, [a.id]: true }))
    } catch (e) {
      toast.error(e.message || 'Could not dismiss alert')
    }
  }

  if (bizLoading) {
    return (
      <div>
        <PageHeader title="Cash Flow" subtitle="Loading your projected balances…" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      </div>
    )
  }

  if (!bizId) {
    return (
      <div>
        <PageHeader title="Cash Flow" subtitle="Weekly projected balances and cash-gap warnings." back="/orders" />
        <EmptyState
          icon="▽"
          title="No business profile"
          description="Cash-flow forecasting needs a registered business on your account."
          action={<Link to="/profile" className="btn-gold btn-sm">Complete profile</Link>}
        />
      </div>
    )
  }

  const negative = (flow?.lowest_projected_balance ?? 0) < 0
  const delta = scenario?.delta

  return (
    <div>
      <PageHeader
        title="Cash Flow"
        subtitle={`Projected weekly balance for ${biz?.legal_name || 'your business'} over the next ${flow?.horizon_weeks ?? weeks} weeks.`}
        actions={
          <select className="input w-auto py-1.5 text-sm" value={weeks} onChange={(e) => { setScenario(null); setWeeks(Number(e.target.value)) }}>
            {HORIZONS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
        }
      />

      {error ? (
        <EmptyState icon="⚠" title="Could not load the forecast" description={error} action={<button className="btn-gold btn-sm" onClick={reload}>Retry</button>} />
      ) : loading || !flow ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Current balance" value={fmtMoney(flow.current_balance)} icon="$" tone="gold" hint={`Opening ${fmtMoney(flow.opening_balance)}`} />
            <StatCard label="Expected receipts (30d)" value={fmtMoney(flow.expected_receipts_30d)} icon="⇧" tone="green" hint="Scheduled buyer settlements" />
            <StatCard
              label="Lowest projected balance"
              value={negative
                ? <span className="text-red-300">{fmtMoney(flow.lowest_projected_balance)}</span>
                : fmtMoney(flow.lowest_projected_balance)}
              icon="▽"
              tone={negative ? 'red' : 'navy'}
              hint={negative ? `Cash gap in the week of ${flow.lowest_week}` : `Week of ${flow.lowest_week}`}
            />
          </div>

          {/* Cash-gap banner */}
          {flow.gap_weeks > 0 && (
            <div className="mb-6 rounded-xl border border-red-400/30 bg-red-500/10 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg text-red-300">⚠</span>
                <h2 className="text-sm font-semibold text-red-200">
                  Cash gap forecast in {flow.gap_weeks} week{flow.gap_weeks === 1 ? '' : 's'}
                </h2>
                <span className="chip ml-auto border border-red-400/30 bg-red-500/15 text-[11px] text-red-300">
                  Low {fmtMoney(flow.lowest_projected_balance)} · {flow.lowest_week}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-300">
                Projected balance turns negative in the week of{' '}
                <span className="font-semibold text-red-200">
                  {gapWeeks.slice(0, 6).map((w) => w.week_label).join(', ')}
                  {gapWeeks.length > 6 && ` +${gapWeeks.length - 6} more`}
                </span>.
                Consider a simulated advance on the order page, or model a delay below before committing to new orders.
              </p>
            </div>
          )}

          {flow.gap_weeks === 0 && (
            <div className="mb-6 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              ✓ No negative weeks projected across {flow.horizon_weeks} weeks — lowest point {fmtMoney(flow.lowest_projected_balance)} in the week of {flow.lowest_week}.
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Chart */}
            <div className="card-pad lg:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="section-title">Weekly forecast</h2>
                <span className="text-[11px] text-slate-500">{flow.method}</span>
              </div>
              <div className="h-[19rem] sm:h-[22rem]">
                <Bar data={chart} options={chartOptions} />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Bars show net cash movement per week; the line shows the running projected balance, in{' '}
                <span className="text-red-300">red</span> where the week is forecast as a cash gap.
              </p>
            </div>

            {/* Alerts */}
            <div className="card-pad">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">Unread alerts</h2>
                <span className="text-[11px] text-slate-500">{alerts.length}</span>
              </div>
              {alerts.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Nothing needs your attention.</p>
              ) : (
                <ul className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                  {alerts.map((a) => {
                    const sev = ALERT_SEVERITY[a.severity] || ALERT_SEVERITY.info
                    const type = ALERT_TYPE[a.type] || { label: a.type, icon: '•' }
                    return (
                      <li key={a.id} className="rounded-lg border border-white/10 bg-navy-900/40 p-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${sev.dot}`} />
                          <span className={`chip border px-1.5 py-0 text-[10px] uppercase tracking-wider ${sev.chip}`}>{type.label}</span>
                          <span className="ml-auto text-[11px] text-slate-500">{timeAgo(a.created_at)}</span>
                        </div>
                        <p className="mt-2 text-xs leading-snug text-slate-200">{a.message}</p>
                        <div className="mt-2 flex items-center justify-between">
                          {a.order_id != null
                            ? <Link to={`/orders/${a.order_id}`} className="text-[11px] text-gold hover:underline">Order #{String(a.order_id).padStart(5, '0')} →</Link>
                            : <span />}
                          <button className="btn-ghost btn-sm" onClick={() => dismissAlert(a)}>Dismiss</button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* What-if panel */}
          <div className="card-pad mt-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="section-title">What-if: a buyer pays late</h2>
                <p className="mt-1 text-sm text-slate-400">Model a delayed receipt without touching the persisted forecast.</p>
              </div>
              <span className="chip border border-violet-400/30 bg-violet-500/10 text-[11px] text-violet-300">Scenario only</span>
            </div>

            {activeOrders.length === 0 ? (
              <p className="text-sm text-slate-500">No active orders to model — every order is settled or closed.</p>
            ) : (
              <div className="grid gap-5 lg:grid-cols-3">
                <div className="space-y-4">
                  <div>
                    <label className="label" htmlFor="scenario-order">Order</label>
                    <select id="scenario-order" className="input" value={orderId} onChange={(e) => { setOrderId(e.target.value); setScenario(null) }}>
                      {activeOrders.map((o) => (
                        <option key={o.id} value={o.id}>
                          #{String(o.id).padStart(5, '0')} · {o.goods} · {fmtMoney(o.amount, o.currency)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="scenario-delay">
                      Payment delay: <span className="text-gold">{delay} days</span>
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        id="scenario-delay"
                        type="range"
                        min={0}
                        max={180}
                        step={1}
                        value={delay}
                        onChange={(e) => setDelay(Number(e.target.value))}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-navy-700 accent-gold"
                      />
                      <input
                        type="number"
                        min={0}
                        max={180}
                        value={delay}
                        onChange={(e) => setDelay(Math.min(180, Math.max(0, Number(e.target.value) || 0)))}
                        className="input w-20 py-1.5 text-right text-sm tabular-nums"
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">0–180 days</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="btn-gold btn-sm" onClick={runScenario} disabled={scenarioBusy || !orderId}>
                      {scenarioBusy && <Spinner size={14} className="text-navy-950" />}
                      Run scenario
                    </button>
                    {scenario && (
                      <button className="btn-ghost btn-sm" onClick={() => setScenario(null)}>Clear overlay</button>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-2">
                  {!delta ? (
                    <div className="flex h-full min-h-[8rem] items-center justify-center rounded-lg border border-dashed border-white/10 bg-navy-900/40 px-4 text-center text-sm text-slate-500">
                      Pick an order and a delay, then run the scenario to see the extra gap weeks and the dashed overlay on the chart.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-white/10 bg-navy-900/40 p-4">
                          <p className="section-title">Extra gap weeks</p>
                          <p className={`mt-1.5 text-2xl font-extrabold tabular-nums ${delta.gap_weeks > 0 ? 'text-red-300' : delta.gap_weeks < 0 ? 'text-emerald-300' : 'text-slate-200'}`}>
                            {delta.gap_weeks > 0 ? `+${fmtNum(delta.gap_weeks)}` : delta.gap_weeks < 0 ? fmtNum(delta.gap_weeks) : 'No change'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Scenario forecast has {scenario.forecast.gap_weeks} gap week{scenario.forecast.gap_weeks === 1 ? '' : 's'} vs {flow.gap_weeks} today.
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-navy-900/40 p-4">
                          <p className="section-title">Lowest-balance change</p>
                          <p className={`mt-1.5 text-2xl font-extrabold tabular-nums ${delta.lowest_balance_change < 0 ? 'text-red-300' : delta.lowest_balance_change > 0 ? 'text-emerald-300' : 'text-slate-200'}`}>
                            {delta.lowest_balance_change === 0 ? 'No change' : `${delta.lowest_balance_change > 0 ? '+' : ''}${fmtMoney(delta.lowest_balance_change)}`}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Lowest projected {fmtMoney(scenario.forecast.lowest_projected_balance)} in the week of {scenario.forecast.lowest_week}.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2">
                        <span className="text-gold">ⓘ</span>
                        <p className="text-xs text-gold">{scenario.note}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default CashFlow
