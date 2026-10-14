export function StatCard({ label, value, delta, icon, tone = 'navy', hint, loading }) {
  const accent = {
    gold: 'text-gold bg-gold/10',
    navy: 'text-sky-300 bg-sky-500/10',
    green: 'text-emerald-300 bg-emerald-500/10',
    red: 'text-red-300 bg-red-500/10',
    violet: 'text-violet-300 bg-violet-500/10',
  }[tone] || 'text-sky-300 bg-sky-500/10'

  return (
    <div className="card-pad relative overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-title">{label}</p>
          {loading ? (
            <div className="mt-2 h-8 w-24 skeleton" />
          ) : (
            <p className="mt-1.5 text-3xl font-extrabold tracking-tight text-white tabular-nums">{value}</p>
          )}
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {icon && <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl ${accent}`}>{icon}</div>}
      </div>
      {delta != null && (
        <div className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold ${delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
          <span className="font-normal text-slate-500">vs last period</span>
        </div>
      )}
    </div>
  )
}

export default StatCard
