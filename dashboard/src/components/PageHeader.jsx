import { Link } from 'react-router-dom'

export function PageHeader({ title, subtitle, back, actions, className = '' }) {
  return (
    <div className={`mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        {back && (
          <Link to={back} className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-gold">
            ← Back
          </Link>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  )
}

export default PageHeader
