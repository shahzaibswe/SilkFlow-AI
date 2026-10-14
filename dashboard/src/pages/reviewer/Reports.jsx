import { useState } from 'react'
import { Bar } from 'react-chartjs-2'
import '../../components/chartSetup'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { StatCard } from '../../components/StatCard'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { fmtMoney, fmtNum, downloadCSV, CHART_COLORS } from '../../utils'

const STATUS_ORDER = ['draft', 'docs_checked', 'scored', 'awaiting_funding', 'funded', 'shipped', 'released', 'settled', 'disputed', 'resolved', 'rejected']
const BAND_ORDER = ['low', 'medium', 'high', 'unrated']
const BAND_COLOR = { low: CHART_COLORS.emerald, medium: CHART_COLORS.gold, high: CHART_COLORS.red, unrated: CHART_COLORS.slate }

function toPairs(obj, order) {
  const keys = Object.keys(obj || {})
  keys.sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  return keys.map((k) => [k, obj[k]])
}

const baseOpts = (color) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
    y: { beginAtZero: true, precision: 0, grid: { color: 'rgba(255,255,255,0.06)' } },
  },
})

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export function Reports() {
  const toast = useToast()
  const [range, setRange] = useState({ date_from: '', date_to: '' })
  const { data, loading } = useAsync(() => api.reportsSummary(range), [range.date_from, range.date_to])

  const totals = data?.totals || {}
  const statusPairs = toPairs(data?.by_status, STATUS_ORDER)
  const bandPairs = toPairs(data?.by_risk_band, BAND_ORDER)

  const statusData = {
    labels: statusPairs.map(([k]) => k.replace('_', ' ')),
    datasets: [{ data: statusPairs.map(([, v]) => v), backgroundColor: CHART_COLORS.navy, borderRadius: 5, barThickness: 22 }],
  }
  const bandData = {
    labels: bandPairs.map(([k]) => k),
    datasets: [{ data: bandPairs.map(([, v]) => v), backgroundColor: bandPairs.map(([k]) => BAND_COLOR[k] || CHART_COLORS.slate), borderRadius: 5, barThickness: 22 }],
  }

  const exportCSV = () => {
    if (!data) { toast.warn('Report still loading'); return }
    const rows = [
      { metric: 'orders', value: totals.orders },
      { metric: 'settled_value', value: totals.settled_value },
      { metric: 'released_count', value: totals.released_count },
      { metric: 'disputes', value: totals.disputes },
      { metric: 'dispute_rate', value: totals.dispute_rate },
      { metric: 'avg_score', value: totals.avg_score },
      ...statusPairs.map(([k, v]) => ({ metric: `by_status.${k}`, value: v })),
      ...bandPairs.map(([k, v]) => ({ metric: `by_risk_band.${k}`, value: v })),
    ]
    downloadCSV(`silkflow-report-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast.success('Report exported')
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Platform-wide settlement, risk and dispute analytics."
        actions={
          <>
            <input type="date" className="input w-auto py-1.5 text-sm" value={range.date_from} max={range.date_to || undefined} onChange={(e) => setRange((r) => ({ ...r, date_from: e.target.value }))} />
            <input type="date" className="input w-auto py-1.5 text-sm" value={range.date_to} min={range.date_from || undefined} onChange={(e) => setRange((r) => ({ ...r, date_to: e.target.value }))} />
            <button className="btn-ghost btn-sm" onClick={() => setRange({ date_from: daysAgo(30), date_to: new Date().toISOString().slice(0, 10) })}>Last 30d</button>
            <button className="btn-ghost btn-sm" onClick={() => setRange({ date_from: '', date_to: '' })}>All</button>
            <button className="btn-gold btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Orders" value={fmtNum(totals.orders)} icon="▣" tone="navy" loading={loading} />
        <StatCard label="Settled value" value={fmtMoney(totals.settled_value, 'USD')} icon="$" tone="green" loading={loading} />
        <StatCard label="Released" value={fmtNum(totals.released_count)} icon="⇧" tone="gold" loading={loading} />
        <StatCard label="Dispute rate" value={totals.dispute_rate != null ? `${Math.round(totals.dispute_rate * 100)}%` : '—'} icon="⚠" tone="red" loading={loading} hint={`${fmtNum(totals.disputes)} disputes`} />
        <StatCard label="Avg score" value={totals.avg_score != null ? Math.round(totals.avg_score) : '—'} icon="◎" tone="violet" loading={loading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card-pad">
          <h2 className="mb-4 section-title">Orders by status</h2>
          {loading ? <div className="skeleton h-64" /> : statusPairs.length === 0 ? <EmptyState title="No data" /> : (
            <div style={{ height: 260 }}><Bar data={statusData} options={baseOpts()} /></div>
          )}
        </div>
        <div className="card-pad">
          <h2 className="mb-4 section-title">Orders by risk band</h2>
          {loading ? <div className="skeleton h-64" /> : bandPairs.length === 0 ? <EmptyState title="No data" /> : (
            <div style={{ height: 260 }}><Bar data={bandData} options={baseOpts()} /></div>
          )}
        </div>
      </div>

      {data?.recent && data.recent.length > 0 && (
        <div className="card-pad mt-6">
          <h2 className="mb-3 section-title">Recent activity</h2>
          <ul className="divide-y divide-white/5">
            {data.recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-slate-200">{o.goods} <span className="text-slate-500">· #{String(o.id).padStart(5, '0')}</span></span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums text-white">{fmtMoney(o.amount, o.currency)}</span>
                  <span className="chip border border-white/10 capitalize text-slate-300">{o.status}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default Reports
