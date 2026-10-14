// src/components/FinancingOffers.jsx
// ---------------------------------------------------------------------------
// "Simulated financing" panel for the order detail page. Pulls ranked prototype
// offers from GET /api/orders/{id}/financing-options (only once the order has a
// score) and lets the selling exporter apply via POST /api/orders/{id}/
// financing-requests. Offers are never presented as real credit.
// ---------------------------------------------------------------------------
import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import { useAsync } from '../hooks'
import { useAuth } from '../auth'
import { useToast } from './Toast'
import { Spinner } from './Spinner'
import { fmtMoney, fmtNum } from '../utils'

const RANK_TONE = {
  1: 'border-gold/40 bg-gold/15 text-gold',
  2: 'border-sky-400/30 bg-sky-500/15 text-sky-300',
  3: 'border-white/10 bg-white/5 text-slate-300',
}

function Field({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium tabular-nums text-slate-100">{children}</span>
    </div>
  )
}

export function FinancingOffers({ order, canApply }) {
  const toast = useToast()
  const { role } = useAuth()
  const [busyId, setBusyId] = useState(null)
  const scored = !!(order.credit_score || order.score != null)

  const { data, loading, error, reload } = useAsync(
    () => (scored ? api.financingOptions(order.id) : Promise.resolve(null)),
    [order.id, scored],
  )

  const apply = async (offer) => {
    setBusyId(offer.id)
    try {
      await api.applyFinancing(order.id, { offer_id: offer.id })
      toast.success('Simulated request recorded (prototype only)')
      await reload()
    } catch (e) {
      toast.error(e.message || 'Could not record the simulated request')
    } finally {
      setBusyId(null)
    }
  }

  if (!scored) {
    return (
      <div className="card-pad">
        <h2 className="mb-2 section-title">Simulated financing</h2>
        <p className="text-sm text-slate-500">Prototype offers appear once this order has a credit score.</p>
      </div>
    )
  }

  const offers = data?.offers || []

  return (
    <div className="card-pad">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Simulated financing</h2>
        <span className="chip border border-violet-400/30 bg-violet-500/10 text-[10px] uppercase tracking-wider text-violet-300">
          Simulated · prototype
        </span>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2">
        <span className="text-gold">ⓘ</span>
        <p className="text-xs font-medium text-gold">{data?.disclaimer || 'Prototype offers only — not a real lending commitment.'}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-400"><Spinner size={16} /> Generating offers…</div>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-sm text-red-300">{error}</p>
          <button className="btn-ghost btn-sm" onClick={reload}>Retry</button>
        </div>
      ) : offers.length === 0 ? (
        <p className="text-sm text-slate-500">No prototype offers were generated for this order.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {offers.map((o) => {
            const requested = o.status === 'requested'
            return (
              <div key={o.id} className={`flex flex-col rounded-xl border bg-navy-900/40 p-4 ${requested ? 'border-emerald-400/30' : 'border-white/10'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{o.offer_type}</p>
                    <p className="mt-0.5 text-xs text-slate-500">Simulated facility</p>
                  </div>
                  <span className={`chip shrink-0 border text-[10px] font-bold uppercase ${RANK_TONE[o.rank] || RANK_TONE[3]}`}>
                    Rank {fmtNum(o.rank)}
                  </span>
                </div>

                <div className="mt-3">
                  <Field label="Amount">{fmtMoney(o.amount, 'USD')}</Field>
                  <Field label="Fee">{o.fee_pct}%</Field>
                  <Field label="Term">{o.term_days} days</Field>
                  <Field label="Estimated cost">{fmtMoney(o.estimated_cost, 'USD')}</Field>
                  <Field label="Net payout">{fmtMoney(o.net_payout, 'USD')}</Field>
                </div>

                <p className="mt-3 flex-1 text-xs leading-snug text-slate-400">{o.reason}</p>

                <div className="mt-4">
                  {canApply ? (
                    <button
                      className={requested ? 'btn-ghost btn-sm w-full' : 'btn-gold btn-sm w-full'}
                      disabled={requested || busyId === o.id}
                      onClick={() => apply(o)}
                    >
                      {busyId === o.id && <Spinner size={14} className={requested ? '' : 'text-navy-950'} />}
                      {requested ? '✓ Requested' : 'Apply (simulated)'}
                    </button>
                  ) : (
                    <span className={`chip w-full justify-center border ${requested ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'}`}>
                      {requested ? '✓ Requested by exporter' : 'Selling exporter applies'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-[11px] text-slate-500">
        <span>Requests are recorded as prototype alerts for the reviewer queue — no funds move.</span>
        {role === 'exporter' && <Link to="/cash-flow" className="text-gold hover:underline">Model the cash impact →</Link>}
      </div>
    </div>
  )
}

export default FinancingOffers
