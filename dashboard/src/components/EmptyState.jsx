export function EmptyState({ icon = '◳', title = 'Nothing here yet', description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-navy-800/40 px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-2xl text-slate-500">{icon}</div>
      <h3 className="text-base font-semibold text-slate-200">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export default EmptyState
