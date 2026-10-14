import { useState } from 'react'
import { truncateMid, copyToClipboard } from '../utils'

export function HashLink({ hash, label, explorerUrl, max = 8, mono = true, className = '' }) {
  const [copied, setCopied] = useState(false)
  if (!hash) return <span className="text-slate-500">—</span>

  const copy = async () => {
    const ok = await copyToClipboard(hash)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1400) }
  }

  const inner = (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-slate-400">{label}</span>}
      <code className={`rounded bg-navy-900/70 px-1.5 py-0.5 text-[11px] text-slate-300 ${mono ? 'font-mono' : ''}`}>
        {truncateMid(hash, max)}
      </code>
      <span className={`text-[10px] font-bold ${copied ? 'text-emerald-400' : 'text-slate-500'}`}>{copied ? 'COPIED' : 'COPY'}</span>
    </span>
  )

  return (
    <button
      type="button"
      onClick={copy}
      title={`${hash}\nClick to copy`}
      className={`group inline-flex items-center rounded-md border border-white/5 px-1.5 py-1 hover:border-gold/30 hover:bg-white/5 transition ${className}`}
    >
      {explorerUrl ? (
        <a href={explorerUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-sky-300 hover:text-sky-200" title="Open explorer">⧉</a>
      ) : null}
      {inner}
    </button>
  )
}

export default HashLink
