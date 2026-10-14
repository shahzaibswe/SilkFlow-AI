import { STATUS_META, BAND_META } from '../utils'

export function StatusPill({ status, className = '' }) {
  const meta = STATUS_META[status] || { label: status, pill: 'bg-slate-500/15 text-slate-300 border-slate-400/30' }
  return (
    <span className={`chip border ${meta.pill} ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {meta.label}
    </span>
  )
}

export function BandPill({ band, className = '' }) {
  if (!band) return <span className="chip border border-white/10 text-slate-500">Unrated</span>
  const meta = BAND_META[band]
  return (
    <span className={`chip border ${meta.bg} ${meta.text} ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.label} risk
    </span>
  )
}

export default StatusPill
