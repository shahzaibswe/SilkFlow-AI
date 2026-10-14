import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useAuth } from '../../auth'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill, BandPill } from '../../components/StatusPill'
import { ScoreGauge } from '../../components/ScoreGauge'
import { ReasonsBarChart } from '../../components/ReasonsBarChart'
import { EscrowTracker } from '../../components/EscrowTracker'
import { FinancingOffers } from '../../components/FinancingOffers'
import { HashLink } from '../../components/HashLink'
import { Timeline } from '../../components/Timeline'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import { SkeletonCard } from '../../components/Skeleton'
import { fmtMoney, fmtNum, fmtDate, SEVERITY, CHECK_META, DECISION_META } from '../../utils'

const DOC_LABEL = { invoice: 'Invoice', packing_list: 'Packing list', order_terms: 'Order terms' }

function Field({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2.5 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium text-slate-100">{children}</span>
    </div>
  )
}

function shipmentTone(type) {
  return type === 'delivery' ? 'green' : type === 'in_transit' ? 'blue' : 'gold'
}

export function OrderDetail() {
  const { id } = useParams()
  const toast = useToast()
  const { role } = useAuth()
  const { data: order, loading, error, reload } = useAsync(() => api.getOrder(id).catch((e) => { throw e }), [id])
  // Own business id — used to decide who may apply for a simulated offer.
  const { data: mine } = useAsync(
    () => (role === 'exporter' ? api.myBusiness().catch(() => null) : Promise.resolve(null)),
    [role],
  )
  const canApply = role === 'exporter' && mine?.id != null && Number(mine.id) === Number(order?.seller_id)

  const [busy, setBusy] = useState(null)
  const [confirm, setConfirm] = useState(null) // 'shipment' | 'dispute'
  const [disputeReason, setDisputeReason] = useState('')

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
        <PageHeader title="Order" subtitle="Loading trade detail…" back="/orders" />
        <div className="grid gap-6 lg:grid-cols-2">
          <SkeletonCard /> <SkeletonCard />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Order" back="/orders" />
        <EmptyState icon="⚠" title="Could not load order" description={error} action={<button className="btn-gold btn-sm" onClick={reload}>Retry</button>} />
      </div>
    )
  }

  if (!order) return <EmptyState title="Order not found" />

  const cs = order.credit_score
  const check = order.document_check
  const disc = check?.discrepancies || []
  const escrow = order.escrow

  const shipmentItems = (order.shipment_events || []).map((e) => ({
    id: e.id,
    title: e.event_type.replace('_', ' '),
    subtitle: e.payload?.location ? `${e.payload.carrier || 'Carrier'} · ${e.payload.location}` : e.payload?.carrier,
    time: fmtDate(e.received_at, true),
    tone: shipmentTone(e.event_type),
    icon: e.event_type === 'delivery' ? '✓' : e.event_type === 'in_transit' ? '➤' : '▣',
  }))

  const agentItems = (order.agent_actions || []).map((a) => {
    const meta = DECISION_META[a.decision] || DECISION_META.hold
    return {
      id: a.id,
      title: `${a.action.replace('_', ' ')} · ${a.decision}`,
      subtitle: a.reason,
      time: fmtDate(a.timestamp, true),
      tone: a.decision === 'release' || a.decision === 'approve' ? 'green' : a.decision === 'reject' ? 'red' : 'gold',
      icon: meta.icon,
      meta: a.tx_hash ? <HashLink hash={a.tx_hash} label="tx" max={6} /> : undefined,
    }
  })

  return (
    <div>
      <PageHeader
        title={`${order.goods}`}
        subtitle={`Order #${String(order.id).padStart(5, '0')} · ${order.seller_name} → ${order.buyer_name}`}
        back="/orders"
        actions={
          <>
            <StatusPill status={order.status} />
            {order.escrow_state && <span className="chip border border-white/10 text-slate-300">{order.escrow_state}</span>}
          </>
        }
      />

      {/* Dispute banner */}
      {order.dispute && (
        <div className="mb-6 rounded-xl border border-red-400/30 bg-red-500/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
              <span className="text-lg">⚠</span>
              Dispute raised by {order.dispute.raised_by} · {order.dispute.status}
            </div>
            {order.dispute.resolution && <span className="chip border border-violet-400/30 bg-violet-500/10 text-violet-300">Resolved: {order.dispute.resolution}</span>}
          </div>
          <p className="mt-2 text-sm text-slate-300">{order.dispute.reason}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT: terms + documents + doc check */}
        <div className="space-y-6">
          <div className="card-pad">
            <h2 className="mb-2 section-title">Trade terms</h2>
            <Field label="Value">{fmtMoney(order.amount, order.currency)}</Field>
            <Field label="Quantity">{fmtNum(order.quantity)} units</Field>
            <Field label="Payment term">{order.payment_term_days} days</Field>
            <Field label="Ship by">{fmtDate(order.ship_by)}</Field>
            <Field label="Buyer">{order.buyer_name}</Field>
            <Field label="Created">{fmtDate(order.created_at, true)}</Field>
          </div>

          <div className="card-pad">
            <h2 className="mb-3 section-title">Documents</h2>
            {(order.documents || []).length === 0 ? (
              <p className="text-sm text-slate-500">No documents uploaded yet.</p>
            ) : (
              <ul className="space-y-2">
                {order.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-navy-900/40 px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-slate-200">
                      <span className="text-slate-500">📄</span>
                      {DOC_LABEL[d.type] || d.type}
                    </span>
                    <span className="truncate font-mono text-[11px] text-slate-500">{d.file_name}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button className="btn-ghost btn-sm" disabled={busy === 'check'} onClick={() => act('check', () => api.checkDocuments(order.id), 'Document check re-run')}>
                {busy === 'check' && <Spinner size={14} />}
                Re-check documents
              </button>
            </div>
          </div>

          {/* Doc check with severity highlights */}
          <div className="card-pad">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Document check</h2>
              {check ? (
                <span className={`chip border ${CHECK_META[check.result]?.chip}`}>{CHECK_META[check.result]?.label || check.result}</span>
              ) : (
                <span className="text-xs text-slate-500">Not run</span>
              )}
            </div>
            {disc.length === 0 ? (
              <p className="text-sm text-emerald-300">{check ? 'No discrepancies found — documents are consistent.' : 'Run a document check to see discrepancies.'}</p>
            ) : (
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
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                        {dd.invoice_value != null && <span className="text-slate-400">Invoice: <span className="font-mono text-slate-200">{dd.invoice_value}</span></span>}
                        {dd.packing_list_value != null && <span className="text-slate-400">Packing: <span className="font-mono text-red-300">{dd.packing_list_value}</span></span>}
                        {dd.order_terms_value != null && <span className="text-slate-400">Terms: <span className="font-mono text-red-300">{dd.order_terms_value}</span></span>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT: score + escrow */}
        <div className="space-y-6">
          <div className="card-pad">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Credit score</h2>
              <BandPill band={order.risk_band} />
            </div>
            <div className="flex items-center justify-center py-2">
              <ScoreGauge score={cs?.score ?? order.score} band={cs?.risk_band ?? order.risk_band} />
            </div>
            {cs && (
              <>
                <p className="mt-2 text-center text-xs text-slate-500">Model {cs.model_version}</p>
                <div className="mt-4">
                  <h3 className="mb-1 section-title">Why this score</h3>
                  <ReasonsBarChart features={cs.top_features} />
                </div>
              </>
            )}
            <div className="mt-4 flex justify-end">
              <button className="btn-primary btn-sm" disabled={busy === 'score'} onClick={() => act('score', () => api.scoreOrder(order.id), 'Order rescored')}>
                {busy === 'score' && <Spinner size={14} />}
                Re-score
              </button>
            </div>
          </div>

          <div className="card-pad">
            <h2 className="mb-4 section-title">Escrow</h2>
            {escrow ? (
              <>
                <EscrowTracker state={escrow.state} />
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <Field label="Token">{escrow.token}</Field>
                  <Field label="Amount locked">{fmtMoney(escrow.amount, 'USD')}</Field>
                </div>
                <div className="mt-3 space-y-2 rounded-lg bg-navy-900/40 p-3">
                  <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Contract</span><HashLink hash={escrow.contract_address} max={6} /></div>
                  {escrow.tx_fund && <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Fund tx</span><HashLink hash={escrow.tx_fund} max={6} /></div>}
                  {escrow.tx_release && <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Release tx</span><HashLink hash={escrow.tx_release} max={6} /></div>}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">No escrow yet. Once terms are approved and funding is created it will track here.</p>
            )}
          </div>

          {/* FX risk panel */}
          {order.fx_note && (
            <div className="card-pad">
              <h2 className="mb-3 section-title">FX risk</h2>
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-white">{order.fx_note.rate}</span>
                <span className="text-sm text-slate-400">{order.fx_note.base}/{order.fx_note.quote}</span>
                <span className={`chip ml-auto border ${order.fx_note.volatility_pct > 5 ? 'border-gold/40 bg-gold/15 text-gold' : 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'}`}>{order.fx_note.volatility_pct}% vol</span>
              </div>
              <Field label="Window">{order.fx_note.days} days</Field>
              <Field label="Exposure">{order.fx_note.exposure_pct}%</Field>
              <Field label="Source"><span className="capitalize">{order.fx_note.source}</span></Field>
              <p className="mt-3 text-sm text-slate-400">{order.fx_note.note}</p>
            </div>
          )}
        </div>
      </div>

      {/* Simulated financing */}
      <div className="mt-6">
        <FinancingOffers order={order} canApply={canApply} />
      </div>

      {/* Timelines */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card-pad">
          <h2 className="mb-4 section-title">Shipment events</h2>
          <Timeline items={shipmentItems} emptyText="No shipment events recorded" />
        </div>
        <div className="card-pad">
          <h2 className="mb-4 section-title">Agent actions</h2>
          <Timeline items={agentItems} emptyText="The agent has not acted on this order" />
        </div>
      </div>

      {/* Demo action bar */}
      <div className="card-pad mt-6 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="section-title">Demo controls</h2>
          <p className="mt-0.5 text-sm text-slate-500">Drive the flow manually for the hackathon walkthrough.</p>
        </div>
        <button className="btn-ghost btn-sm" disabled={busy === 'agent'} onClick={() => act('agent', () => api.runAgent(order.id), 'Agent decision recorded')}>
          {busy === 'agent' && <Spinner size={14} />} Run agent
        </button>
        <button className="btn-primary btn-sm" disabled={busy === 'escrow'} onClick={() => act('escrow', () => api.createEscrow(order.id), 'Escrow created')}>
          {busy === 'escrow' && <Spinner size={14} />} Create escrow
        </button>
        <button className="btn-gold btn-sm" onClick={() => setConfirm('shipment')}>Simulate shipment</button>
        <button className="btn-danger btn-sm" onClick={() => setConfirm('dispute')}>Simulate dispute</button>
      </div>

      <ShipmentModal
        open={confirm === 'shipment'}
        onClose={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); act('sim', () => api.simulateShipment(order.id, {}), 'Shipment simulated (dispatch → transit → delivery)') }}
      />
      <DisputeModal
        open={confirm === 'dispute'}
        onClose={() => setConfirm(null)}
        value={disputeReason}
        setValue={setDisputeReason}
        onConfirm={() => { const r = disputeReason; setConfirm(null); setDisputeReason(''); act('sim', () => api.simulateDispute(order.id, { reason: r || undefined }), 'Dispute raised') }}
      />
    </div>
  )
}

function ShipmentModal({ open, onClose, onConfirm }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Simulate shipment"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-gold" onClick={onConfirm}>Fire shipment events</button></>}
    >
      <p className="text-sm text-slate-300">This fires the logistics webhook sequence <span className="font-mono text-gold">dispatch → in_transit → delivery</span> and confirms shipment evidence for the agent. Continue?</p>
    </Modal>
  )
}

function DisputeModal({ open, onClose, value, setValue, onConfirm }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Simulate dispute"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={onConfirm}>Raise dispute</button></>}
    >
      <p className="mb-3 text-sm text-slate-300">Raises a buyer dispute on this order and moves escrow to <span className="font-semibold text-red-300">Disputed</span>, queuing it for reviewer resolution.</p>
      <label className="label">Reason (optional)</label>
      <textarea className="input" rows={3} placeholder="e.g. Short shipment vs invoice quantity" value={value} onChange={(e) => setValue(e.target.value)} />
    </Modal>
  )
}

export default OrderDetail
