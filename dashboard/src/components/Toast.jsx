// src/components/Toast.jsx — lightweight toast system (no deps)
import { createContext, useContext, useState, useCallback, useRef } from 'react'

const ToastCtx = createContext(null)

const KIND = {
  success: { ring: 'border-l-emerald-400', icon: '✓', ic: 'text-emerald-400' },
  error:   { ring: 'border-l-red-500',     icon: '✕', ic: 'text-red-400' },
  info:    { ring: 'border-l-gold',        icon: 'i', ic: 'text-gold' },
  warn:    { ring: 'border-l-amber-400',   icon: '!', ic: 'text-amber-400' },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const push = useCallback((message, kind = 'info', ttl = 4200) => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl)
  }, [])

  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id))

  const value = {
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
    warn: (m) => push(m, 'warn'),
  }

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex w-[min(92vw,380px)] flex-col gap-2.5">
        {toasts.map((t) => {
          const k = KIND[t.kind] || KIND.info
          return (
            <div
              key={t.id}
              className={`animate-slide-in pointer-events-auto flex items-start gap-3 rounded-lg border border-white/10 border-l-4 ${k.ring} bg-navy-800/95 px-4 py-3 shadow-card backdrop-blur`}
              role="status"
            >
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-bold ${k.ic}`}>{k.icon}</span>
              <div className="flex-1 text-sm text-slate-100 leading-snug">{t.message}</div>
              <button onClick={() => dismiss(t.id)} className="text-slate-500 hover:text-slate-200" aria-label="Dismiss">✕</button>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const c = useContext(ToastCtx)
  if (!c) throw new Error('useToast must be used within ToastProvider')
  return c
}
