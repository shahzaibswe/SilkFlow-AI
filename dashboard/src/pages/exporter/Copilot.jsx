import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useAuth } from '../../auth'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { fmtMoney } from '../../utils'

const SUGGESTIONS = [
  'Do I have a cash gap in the next 12 weeks?',
  'What receipts land in the next 30 days?',
  'Which order should I finance first?',
  'Why was my last order scored low?',
]

const FIGURE_LABELS = {
  current_balance: 'Current balance',
  expected_receipts_30d: 'Receipts (30d)',
  lowest_projected_balance: 'Lowest projected',
  lowest_week: 'Lowest week',
  gap_weeks: 'Gap weeks',
}

const moneyKeys = ['current_balance', 'expected_receipts_30d', 'lowest_projected_balance']

function figureChip(key, value) {
  const label = FIGURE_LABELS[key] || String(key).replace(/_/g, ' ')
  const text = moneyKeys.includes(key) && typeof value === 'number' ? fmtMoney(value) : String(value)
  return `${label}: ${text}`
}

function ModeBadge({ mode }) {
  const isLlm = typeof mode === 'string' && mode.startsWith('llm:')
  const label = isLlm ? `LLM: ${mode.slice(4)}` : 'Deterministic demo'
  return (
    <span className={`chip border text-[10px] uppercase tracking-wider ${isLlm ? 'border-violet-400/30 bg-violet-500/10 text-violet-300' : 'border-white/10 bg-white/5 text-slate-400'}`}>
      {label}
    </span>
  )
}

export function Copilot() {
  const { role } = useAuth()
  const staff = role === 'reviewer' || role === 'admin'

  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [pending, setPending] = useState(false)
  const [businessId, setBusinessId] = useState('')
  const endRef = useRef(null)

  const { data: exporterList, loading: exportersLoading } = useAsync(
    () => (staff ? api.exporters() : Promise.resolve(null)),
    [role],
  )
  const exporters = useMemo(() => exporterList?.businesses || [], [exporterList])

  useEffect(() => {
    if (staff && !businessId && exporters.length) setBusinessId(String(exporters[0].id))
  }, [staff, exporters, businessId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const canAsk = useMemo(
    () => !pending && question.trim().length >= 3 && (!staff || !!businessId),
    [pending, question, staff, businessId],
  )

  const ask = async (text) => {
    const q = (text ?? question).trim()
    if (q.length < 3 || pending) return
    if (staff && !businessId) return
    setMessages((m) => [...m, { id: Date.now(), from: 'user', text: q }])
    setQuestion('')
    setPending(true)
    try {
      const body = { question: q }
      if (staff) body.business_id = Number(businessId)
      const d = await api.askCopilot(body)
      setMessages((m) => [...m, {
        id: Date.now() + 1,
        from: 'assistant',
        text: d.answer,
        mode: d.mode,
        figures: d.cited_figures,
        disclaimer: d.disclaimer,
      }])
    } catch (e) {
      setMessages((m) => [...m, { id: Date.now() + 1, from: 'error', text: e.message || 'The copilot is unavailable right now.' }])
    } finally {
      setPending(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask()
    }
  }

  return (
    <div>
      <PageHeader
        title="Copilot"
        subtitle="Ask about cash position, receipts, risk scores or simulated financing."
        actions={
          staff && (
            <select className="input w-auto py-1.5 text-sm" value={businessId} onChange={(e) => setBusinessId(e.target.value)} disabled={exportersLoading}>
              {exportersLoading && <option value="">Loading businesses…</option>}
              {!exportersLoading && exporters.length === 0 && <option value="">No exporter businesses</option>}
              {exporters.map((b) => <option key={b.id} value={b.id}>{b.legal_name}</option>)}
            </select>
          )
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3">
        <span className="text-gold">ⓘ</span>
        <p className="text-xs text-gold">
          Prototype assistant. Every figure comes from the deterministic forecaster on your real data — answers are
          explanatory only and simulated offers are never a lending commitment.
        </p>
      </div>

      <div className="card flex flex-col overflow-hidden">
        <div className="max-h-[min(60vh,32rem)] min-h-[18rem] flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <EmptyState
              icon="✦"
              title="Ask your first question"
              description={staff ? 'Pick an exporter business above, then ask about its cash position or financing.' : 'Try one of the suggestions below to see cited figures and the answer mode.'}
            />
          ) : messages.map((m) => (
            <div key={m.id} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[min(100%,44rem)] rounded-xl border px-4 py-3 text-sm leading-relaxed ${
                  m.from === 'user'
                    ? 'border-gold/30 bg-gold/10 text-white'
                    : m.from === 'error'
                      ? 'border-red-400/30 bg-red-500/10 text-red-200'
                      : 'border-white/10 bg-navy-900/50 text-slate-200'
                }`}
              >
                {m.from === 'assistant' && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <ModeBadge mode={m.mode} />
                    {m.mode?.startsWith('llm:') && <span className="text-[10px] text-slate-500">LLM narrative over deterministic figures</span>}
                  </div>
                )}
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.from === 'assistant' && m.figures && (
                  <>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Object.entries(m.figures).map(([k, v]) => (
                        <span key={k} className="chip border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">{figureChip(k, v)}</span>
                      ))}
                    </div>
                    {m.disclaimer && <p className="mt-3 border-t border-white/5 pt-2 text-[11px] italic text-slate-500">{m.disclaimer}</p>}
                  </>
                )}
              </div>
            </div>
          ))}
          {pending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-navy-900/50 px-4 py-3 text-sm text-slate-400">
                <Spinner size={14} /> Thinking…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                disabled={pending || (staff && !businessId)}
                className="chip border border-white/10 bg-white/5 text-[11px] text-slate-300 transition hover:border-gold/40 hover:text-gold disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              className="input min-h-[2.75rem] resize-y"
              rows={2}
              maxLength={1000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={pending || (staff && !businessId)}
              placeholder={staff && !businessId ? 'Select an exporter business first…' : 'Ask about cash flow, receipts, scores or financing…'}
            />
            <button className="btn-gold shrink-0" onClick={() => ask()} disabled={!canAsk}>
              {pending && <Spinner size={14} className="text-navy-950" />}
              Ask
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
            <span>Enter sends · Shift+Enter adds a newline</span>
            <span className="tabular-nums">{question.length}/1000</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Copilot
