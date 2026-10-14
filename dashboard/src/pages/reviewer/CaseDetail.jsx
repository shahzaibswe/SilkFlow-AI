import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill, BandPill } from '../../components/StatusPill'
import { ScoreGauge } from '../../components/ScoreGauge'
import { ReasonsBarChart } from '../../components/ReasonsBarChart'
import { EscrowTracker } from '../../components/EscrowTracker'
import { Timeline } from '../../components/Timeline'
import { HashLink } from '../../components/HashLink'
import { ConfirmModal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import { fmtMoney, fmtDate, SEVERITY, CHECK_META, DECISION_META } from '../../utils'

const DOC_LABEL = { invoice: 'Invoice', packing_list: 'Packing list', order_terms: 'Order terms' }
const RESOLUTIONS = [
  { key: 'release', label: 'Release funds to seller', tone: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10' },
  { key: 'refund', label: 'Refund buyer', tone: 'text-red-300 border-red-400/30 bg-red-500/10' },
  { key: 'more_evidence', label: 'Request more evidence', tone: 'text-gold border-gold/40 bg-gold/10' },
]

function RuleChips({ checks = [] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {checks.map((c, i) => (
        <span
          key={i}
          title={c.detail}
          className={`chip border text-[11px] ${c.passed ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-red-400/30 bg-red-500/10 text-red-300'}`}
        >
          {c.passed ? '✓' : '✕'} {c.rule}
        </span>
      ))}
    </div>
  )
}

export function CaseDetail() {
  const { id } = useParams()
  const toast = useToast()
  const { data: order, loading, error, reload } = useAsync(() => api.getOrder(id), [id])

  const [busy, setBusy] = useState(null)
  const [decision, setDecision] = useState('release')
  const [notes, setNotes] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const act = async (key, fn, okMsg) => {
    setBusy(key)
    try {
      await fn()
      if (okMsg) toast.success(okMsg)
      await reload()
    } catch (ex) {
      toast.error(ex.message || 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Case" subtitle="Loading…" back="/cases" />
        <div className="grid gap-6 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="card-pad skeleton h-72" />)}</div>
      </div>
    )
  }
  if (error) {
    return (
      <div>
        <PageHeader title="Case" back="/cases" />
        <EmptyState icon="⚠" title="Could not load case" description={error} action={<button className="btn-gold btn-sm" onClick={reload}>Retry</button>} />
      </div>
    )
  }
  if (!order) return <EmptyState title="Case not found" />

  const cs = order.credit_score
  const check = order.document_check
  const disc = check?.discrepancies || []
  const dispute = order.dispute
  const actions = order.agent_actions || []

  const shipmentItems = (order.shipment_events || []).map((e) => ({
    id: e.id,
    title: e.event_type.replace('_', ' '),
    subtitle: e.payload?.location ? `${e.payload.carrier || 'Carrier'} · ${e.payload.location}` : undefined,
    time: fmtDate(e.received_at, true),
    tone: e.event_type === 'delivery' ? 'green' : e.event_type === 'in_transit' ? 'blue' : 'gold',
    icon: e.event_type === 'delivery' ? '✓' : '➤',
  }))

  const resolve = () => act('resolve', () => api.resolveDispute(dispute.id, { decision, notes: notes || undefined }), `Dispute resolved: ${decision}`)

  return (
    <div>
      <PageHeader
        title={`${order.goods}`}
        subtitle={`Case #${String(order.id).padStart(5, '0')} · ${order.seller_name} → ${order.buyer_name} · ${fmtMoney(order.amount, order.currency)}`}
        back="/cases"
        actions={<><BandPill band={order.risk_band} /><StatusPill status={order.status} /></>}
      />

      {/* Dispute banner */}
      {dispute && (
        <div className={`mb-6 rounded-xl border p-4 ${dispute.status === 'open' ? 'border-red-400/30 bg-red-500/10' : 'border-violet-400/30 bg-violet-500/10'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold text-red-300">{dispute.status === 'open' ? '⚠ Open dispute' : '✓ Dispute resolved'}</span>
              <span className="ml-2 text-slate-300">raised by {dispute.raised_by}</span>
              {dispute.resolution && <span className="ml-2 text-violet-300">→ {dispute.resolution}</span>}
            </div>
            {dispute.resolved_at && <span className="text-xs text-slate-500">{fmtDate(dispute.resolved_at, true)}</span>}
          </div>
          <p className="mt-2 text-sm text-slate-300">{dispute.reason}</p>
          {dispute.notes && <p className="mt-1 text-xs text-slate-400">Reviewer notes: {dispute.notes}</p>}
        </div>
      )}

      {/* 3-panel grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Panel 1: documents */}
        <div className="card-pad">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Documents</h2>
            {check && <span className={`chip border ${CHECK_META[check.result]?.chip}`}>{CHECK_META[check.result]?.label}</span>}
          </div>
          <ul className="mb-4 space-y-2">
            {(order.documents || []).map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-navy-900/40 px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-slate-200"><span className="text-slate-500">📄</span>{DOC_LABEL[d.type] || d.type}</span>
                <span className="truncate font-mono text-[11px] text-slate-500">{d.file_name}</span>
              </li>
            ))}
            {(order.documents || []).length === 0 && <li className="text-sm text-slate-500">No documents.</li>}
          </ul>
          {disc.length > 0 ? (
            <ul className="space-y-2">
              {disc.map((dd, i) => {
                const sev = SEVERITY[dd.severity] || SEVERITY.medium
                return (
                  <li key={i} className={`rounded-lg border border-white/10 border-l-4 px-3 py-2 ${sev.row}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-100">{dd.field.replace(/_/g, ' ')}</span>
                      <span className={`chip border text-[10px] uppercase ${sev.cls}`}>{sev.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{dd.description}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-[11px]">
                      {dd.invoice_value != null && <span className="text-slate-400">Inv: <span className="font-mono text-slate-200">{dd.invoice_value}</span></span>}
                      {dd.packing_list_value != null && <span className="text-slate-400">Pack: <span className="font-mono text-red-300">{dd.packing_list_value}</span></span>}
                      {dd.order_terms_value != null && <span className="text-slate-400">Terms: <span className="font-mono text-red-300">{dd.order_terms_value}</span></span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : <p className="text-sm text-emerald-300">Documents consistent — no discrepancies.</p>}
        </div>

        {/* Panel 2: shipment timeline + escrow */}
        <div className="card-pad">
          <h2 className="mb-4 section-title">Shipment evidence</h2>
          <Timeline items={shipmentItems} emptyText="No shipment events recorded" />
          {order.escrow && (
            <div className="mt-5 border-t border-white/10 pt-4">
              <h3 className="mb-3 section-title">Escrow</h3>
              <EscrowTracker state={order.escrow.state} />
              <div className="mt-3 flex justify-center"><HashLink hash={order.escrow.tx_fund} label="fund tx" max={6} explorerUrl={order.escrow.explorer_url} /></div>
            </div>
          )}
        </div>

        {/* Panel 3: agent reasoning */}
        <div className="card-pad">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Agent reasoning</h2>
            <BandPill band={cs?.risk_band ?? order.risk_band} />
          </div>
          <div className="flex items-center justify-center py-1">
            <ScoreGauge score={cs?.score ?? order.score} band={cs?.risk_band ?? order.risk_band} size={150} />
          </div>
          {cs && <ReasonsBarChart features={cs.top_features} height={180} />}
          <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            {actions.length === 0 ? (
              <p className="text-sm text-slate-500">The agent has not acted on this case.</p>
            ) : actions.map((a) => {
              const meta = DECISION_META[a.decision] || DECISION_META.hold
              return (
                <div key={a.id} className="rounded-lg border border-white/10 bg-navy-900/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className={`chip border text-[11px] ${meta.cls}`}>{meta.icon} {a.decision}</span>
                    <span className="text-[11px] text-slate-500">{fmtDate(a.timestamp, true)}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{a.reason}</p>
                  <div className="mt-2"><RuleChips checks={a.policy_checks} /></div>
                  {a.tx_hash && <div className="mt-2"><HashLink hash={a.tx_hash} label="tx" max={6} /></div>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Resolve bar */}
      {dispute && dispute.status === 'open' ? (
        <div className="card-pad mt-6">
          <h2 className="mb-3 section-title">Resolve dispute</h2>
          <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                {RESOLUTIONS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setDecision(r.key)}
                    className={`chip border transition ${decision === r.key ? r.tone : 'border-white/10 text-slate-400 hover:border-white/20'}`}
                  >
                    {decision === r.key ? '●' : '○'} {r.label}
                  </button>
                ))}
              </div>
              <label className="label">Reviewer notes</label>
              <textarea className="input" rows={2} placeholder="Rationale recorded on the audit trail…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex items-end">
              <button className="btn-gold" onClick={() => setConfirmOpen(true)}>Resolve case</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card-pad mt-6 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="section-title">Demo controls</h2>
            <p className="mt-0.5 text-sm text-slate-500">Drive the flow for the walkthrough.</p>
          </div>
          <button className="btn-ghost btn-sm" disabled={busy === 'agent'} onClick={() => act('agent', () => api.runAgent(order.id), 'Agent decision recorded')}>
            {busy === 'agent' && <Spinner size={14} />} Run agent
          </button>
          <button className="btn-primary btn-sm" onClick={() => act('ship', () => api.simulateShipment(order.id, {}), 'Shipment simulated')}>Simulate shipment</button>
          <Link to="/audit" className="btn-ghost btn-sm">Audit trail →</Link>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); resolve() }}
        title="Confirm resolution"
        tone={decision === 'release' ? 'gold' : 'danger'}
        confirmLabel={`Resolve: ${decision === 'more_evidence' ? 'request evidence' : decision}`}
        loading={busy === 'resolve'}
        message={`You are about to ${decision === 'release' ? 'release escrow funds to the seller' : decision === 'refund' ? 'refund the buyer from escrow' : 'request more evidence and keep the case open'} for case #${String(order.id).padStart(5, '0')}. This writes an immutable audit entry and settles on-chain escrow. Continue?`}
      />
    </div>
  )
}

export default CaseDetail
