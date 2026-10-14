export function Spinner({ size = 20, className = '' }) {
  return (
    <svg
      className={`animate-spin text-gold ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function LoadingBlock({ label = 'Loading…', className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 text-slate-400 ${className}`}>
      <Spinner size={26} />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export default Spinner
