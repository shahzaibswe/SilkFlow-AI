// Horizontal escrow stepper: Created → Funded → Shipped → Released
const STEPS = [
  { key: 'Created', label: 'Created', icon:'▣' },
  { key: 'Funded', label: 'Funded', icon:'$' },
  { key: 'Shipped', label: 'Shipped', icon:'➤' },
  { key: 'Released', label: 'Released', icon:'✓' },
]

// Map on-chain EscrowState -> step index reached
function stepFor(state) {
  switch (state) {
    case 'Created': return 0
    case 'Funded': return 1
    case 'ShipmentConfirmed': return 2
    case 'Released': return 3
    case 'Disputed': return 2
    case 'Refunded': return 2
    default: return -1
  }
}

export function EscrowTracker({ state }) {
  const idx = stepFor(state)
  const terminal = state === 'Disputed' || state === 'Refunded'

  return (
    <div>
      <div className="flex items-start">
        {STEPS.map((s, i) => {
          const done = i < idx
          const active = i === idx
          const color = done || active ? 'gold' : 'idle'
          return (
            <div key={s.key} className="flex flex-1 flex-col items-center last:flex-none">
              <div className="flex w-full items-center">
                {/* connector left */}
                <div className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : (done || active) ? 'bg-gold' : 'bg-white/10'}`} />
                <div
                  className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition
                    ${color === 'gold'
                      ? 'border-gold bg-gold/15 text-gold ' + (active ? 'animate-pulse-ring' : '')
                      : 'border-white/15 bg-navy-900 text-slate-600'}`}
                >
                  {done ? '✓' : s.icon}
                </div>
                {/* connector right */}
                <div className={`h-0.5 flex-1 ${i === STEPS.length - 1 ? 'opacity-0' : done ? 'bg-gold' : 'bg-white/10'}`} />
              </div>
              <span className={`mt-2 text-xs font-semibold ${done || active ? 'text-slate-200' : 'text-slate-500'}`}>{s.label}</span>
            </div>
          )
        })}
      </div>
      {terminal && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-center text-xs font-semibold
          ${state === 'Disputed' ? 'border-red-400/30 bg-red-500/10 text-red-300' : 'border-violet-400/30 bg-violet-500/10 text-violet-300'}`}>
          {state === 'Disputed' ? '⚠ Escrow in dispute — awaiting reviewer resolution' : '↩ Funds refunded to buyer'}
        </div>
      )}
    </div>
  )
}

export default EscrowTracker
