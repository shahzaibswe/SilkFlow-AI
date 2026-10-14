// Generic vertical timeline. items: [{ title, subtitle, time, tone, icon, meta }]
const TONE = {
  gold: 'border-gold bg-gold/10 text-gold',
  green: 'border-emerald-400 bg-emerald-500/10 text-emerald-300',
  red: 'border-red-400 bg-red-500/10 text-red-300',
  blue: 'border-sky-400 bg-sky-500/10 text-sky-300',
  idle: 'border-white/15 bg-navy-900 text-slate-500',
}

export function Timeline({ items = [], emptyText = 'No events yet' }) {
  if (!items.length) return <div className="py-8 text-center text-sm text-slate-500">{emptyText}</div>

  return (
    <ol className="relative ml-2 space-y-5 border-l border-white/10 pl-6">
      {items.map((it, i) => (
        <li key={it.id ?? i} className="relative">
          <span
            className={`absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold ${TONE[it.tone] || TONE.gold}`}
          >
            {it.icon || ''}
          </span>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">{it.title}</p>
              {it.subtitle && <p className="mt-0.5 text-xs text-slate-400">{it.subtitle}</p>}
              {it.meta && <div className="mt-1 text-[11px] text-slate-500">{it.meta}</div>}
            </div>
            {it.time && <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-500">{it.time}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export default Timeline
