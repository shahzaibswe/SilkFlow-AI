import { useEffect } from 'react'
import { Spinner } from './Spinner'

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  if (!open) return null
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size] || 'max-w-lg'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div role="dialog" aria-modal="true" className={`relative w-full ${width} animate-fade-in rounded-xl border border-white/10 bg-navy-800 shadow-card`}>
        {title && (
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close">✕</button>
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-white/10 px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}

// Destructive / confirmation modal used for release, refund, kill switch.
export function ConfirmModal({
  open, onClose, onConfirm, title = 'Are you sure?', message, confirmLabel = 'Confirm',
  cancelLabel = 'Cancel', tone = 'danger', loading = false, requireText,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={loading}>{cancelLabel}</button>
          <button
            className={tone === 'danger' ? 'btn-danger' : 'btn-gold'}
            onClick={onConfirm}
            disabled={loading || (requireText ? true : false)}
          >
            {loading && <Spinner size={16} />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${tone === 'danger' ? 'bg-red-500/15 text-red-300' : 'bg-gold/15 text-gold'}`}>
          {tone === 'danger' ? '⚠' : '•'}
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{message}</p>
      </div>
    </Modal>
  )
}

export default Modal
