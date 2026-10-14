export function Logo({ size = 'md', showWord = true, className = '' }) {
  const dim = size === 'lg' ? 40 : size === 'sm' ? 22 : 30
  const word = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-lg'
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg width={dim} height={dim} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#12294A" stroke="rgba(212,175,55,0.35)" />
        <path d="M8 20c3-6 5-6 8-6s5 6 8-6" stroke="#D4AF37" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M8 25c3-6 5-6 8-6s5 6 8-6" stroke="#335B97" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <circle cx="16" cy="9" r="2.6" fill="#D4AF37" />
      </svg>
      {showWord && (
        <div className="leading-none">
          <span className={`font-extrabold tracking-tight text-white ${word}`}>SilkFlow</span>
          <span className={`font-extrabold tracking-tight text-gold ${word}`}> AI</span>
        </div>
      )}
    </div>
  )
}

export default Logo
