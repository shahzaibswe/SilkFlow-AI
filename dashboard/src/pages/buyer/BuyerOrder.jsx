import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill, BandPill } from '../../components/StatusPill'
import { ScoreGauge } from '../../components/ScoreGauge'
import { EscrowTracker } from '../../components/EscrowTracker'
import { HashLink } from '../../components/HashLink'
import { Timeline } from '../../components/Timeline'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import { fmtMoney, fmtNum, fmtDate, copyToClipboard } from '../../utils'

function Field({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2.5 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium text-slate-100">{children}</span>
    </div>
  )
}

export function BuyerOrder() {
  const { id } = useParams()
  const toast = useToast()
  const { data: order, loading, error, reload } = useAsync(() => api.getOrder(id), [id])

  const [busy, setBusy] = useState(null)
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [copied, setCopied] = useState(false)

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
        <PageHeader title="Order" subtitle="Loading…" back="/inbox" />
        <div className="grid gap-6 lg:grid-cols-2"><div className="card-pad skeleton h-64" /><div className="card-pad skeleton h-64" /></div>
      </div>
    )
  }
  if (error) {
    return (
      <div>
        <PageHeader title="Order" back="/inbox" />
        <EmptyState icon="⚠" title="Could not load order" description={error} action={<button className="btn-gold btn-sm" onClick={reload}>Retry</button>} />
      </div>
    )
  }
  if (!order) return <EmptyState title="Order not found" />

  const escrow = order.escrow
  const cs = order.credit_score
  const hasEscrow = !!escrow
  const canAccept = !hasEscrow && (order.status === 'scored' || order.status === 'docs_checked' || order.status === 'awaiting_funding')
  const canFund = escrow && escrow.state === 'Created'
  const canConfirm = escrow && (escrow.state === 'Funded' || escrow.state === 'ShipmentConfirmed') && order.status !== 'released' && order.status !== 'settled'
  const canDispute = order.status === 'funded' || order.status === 'shipped'

  const copyAddress = async () => {
    if (await copyToClipboard(escrow.contract_address)) { setCopied(true); toast.info('Address copied'); setTimeout(() => setCopied(false), 1400) }
  }

  const shipmentItems = (order.shipment_events || []).map((e) => ({
    id: e.id,
    title: e.event_type.replace('_', ' '),
    subtitle: e.payload?.location ? `${e.payload.carrier || 'Carrier'} · ${e.payload.location}` : undefined,
    time: fmtDate(e.received_at, true),
    tone: e.event_type === 'delivery' ? 'green' : 'gold',
    icon: e.event_type === 'delivery' ? '✓' : '➤',
  }))

  return (
    <div>
      <PageHeader
        title={order.goods}
        subtitle={`Order #${String(order.id).padStart(5, '0')} · from ${order.seller_name}`}
        back="/inbox"
        actions={<><BandPill band={order.risk_band} /><StatusPill status={order.status} /></>}
      />

      {order.dispute && (
        <div className="mb-6 rounded-xl border border-red-400/30 bg-red-500/10 p-4">
          <p className="text-sm font-semibold text-red-300">⚠ Dispute {order.dispute.status} · raised by {order.dispute.raised_by}</p>
          <p className="mt-1 text-sm text-slate-300">{order.dispute.reason}</p>
          {order.dispute.resolution && <p className="mt-1 text-xs text-violet-300">Resolution: {order.dispute.resolution}</p>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT: terms + review actions */}
        <div className="space-y-6">
          <div className="card-pad">
            <h2 className="mb-2 section-title">Trade terms</h2>
            <Field label="Invoice value">{fmtMoney(order.amount, order.currency)}</Field>
            <Field label="Quantity">{fmtNum(order.quantity)} units</Field>
            <Field label="Payment term">{order.payment_term_days} days</Field>
            <Field label="Ship by">{fmtDate(order.ship_by)}</Field>
            <Field label="Supplier">{order.seller_name}</Field>
          </div>

          {/* Fund escrow highlighted box */}
          <div className="card-pad">
            <h2 className="mb-3 section-title">Escrow funding</h2>
            {hasEscrow ? (
              <>
                <EscrowTracker state={escrow.state} />
                <div className="mt-5 rounded-xl border border-gold/30 bg-gold/5 p-4">
                  <div className="flex items-center justify-between">
                    <span className="section-title text-gold">Send to escrow contract</span>
                    <span className="chip border border-gold/40 bg-gold/15 text-gold">{escrow.token}</span>
                  </div>
                  <div className="mt-3 space-y-3">
                    <div>
                      <p className="mb-1 text-xs text-slate-400">Contract address</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 break-all rounded-lg bg-navy-950/70 px-3 py-2 font-mono text-xs text-slate-200">{escrow.contract_address}</code>
                        <button className="btn-ghost btn-sm" onClick={copyAddress}>{copied ? 'Copied' : 'Copy'}</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-navy-950/50 px-3 py-2">
                      <span className="text-xs text-slate-400">Amount to lock</span>
                      <span className="text-lg font-extrabold tabular-nums text-white">{fmtMoney(escrow.amount, 'USD')}</span>
                    </div>
                  </div>

                  {canFund && (
                    <button className="btn-gold mt-4 w-full" disabled={busy === 'fund'} onClick={() => act('fund', () => api.fundEscrow(order.id, {}), 'Escrow funded')}>
                      {busy === 'fund' && <Spinner size={16} className="text-navy-950" />}
                      Fund escrow
                    </button>
                  )}
                  <p className="mt-3 text-center text-xs text-slate-500">
                    Status: <span className="font-semibold text-slate-300">{escrow.state}</span>
                    {escrow.tx_fund && <> · funded on-chain</>}
                  </p>
                  {escrow.tx_fund && <div className="mt-2 flex justify-center"><HashLink hash={escrow.tx_fund} label="fund tx" explorerUrl={escrow.explorer_url} max={8} /></div>}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">The supplier is finalising terms. Once the escrow is created for your approval it will appear here.</p>
            )}
          </div>

          {/* Buyer action bar */}
          <div className="card-pad flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <h2 className="section-title">Your actions</h2>
              <p className="mt-0.5 text-sm text-slate-500">Move this order forward as the buyer.</p>
            </div>
            {canAccept && (
              <button className="btn-gold btn-sm" disabled={busy === 'accept'} onClick={() => act('accept', () => api.createEscrow(order.id), 'Terms accepted — escrow created')}>
                {busy === 'accept' && <Spinner size={14} className="text-navy-950" />}
                Accept terms
              </button>
            )}
            {canConfirm && (
              <button className="btn-primary btn-sm" disabled={busy === 'confirm'} onClick={() => act('confirm', () => api.simulateShipment(order.id, { event_type: 'delivery' }), 'Receipt confirmed')}>
                {busy === 'confirm' && <Spinner size={14} />}
                Confirm receipt
              </button>
            )}
            {canDispute && (
              <button className="btn-danger btn-sm" onClick={() => setDisputeOpen(true)}>Raise dispute</button>
            )}
          </div>
        </div>

        {/* RIGHT: score + shipment */}
        <div className="space-y-6">
          <div className="card-pad">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Supplier risk</h2>
              <BandPill band={cs?.risk_band ?? order.risk_band} />
            </div>
            <div className="flex items-center justify-center py-2">
              <ScoreGauge score={cs?.score ?? order.score} band={cs?.risk_band ?? order.risk_band} />
            </div>
            <p className="mt-2 text-center text-xs text-slate-500">SilkFlow scores this counterparty so you can fund with confidence.</p>
            {order.fx_note && (
              <div className="mt-4 grid gap-2 rounded-lg bg-navy-900/40 p-3 text-sm sm:grid-cols-2">
                <Field label={`${order.fx_note.base}/${order.fx_note.quote}`}>{order.fx_note.rate}</Field>
                <Field label="Volatility">{order.fx_note.volatility_pct}%</Field>
              </div>
            )}
          </div>

          <div className="card-pad">
            <h2 className="mb-4 section-title">Shipment</h2>
            <Timeline items={shipmentItems} emptyText="No shipment events yet" />
          </div>
        </div>
      </div>

      <Modal
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        title="Raise a dispute"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setDisputeOpen(false)}>Cancel</button>
            <button className="btn-danger" disabled={busy === 'dispute'} onClick={() => { const r = reason; setDisputeOpen(false); setReason(''); act('dispute', () => api.raiseDispute(order.id, { reason: r || 'Dispute raised by buyer.' }), 'Dispute raised') }}>
              {busy === 'dispute' && <Spinner size={16} />}
              Raise dispute
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-300">Escrow moves to <span className="font-semibold text-red-300">Disputed</span> and a reviewer will adjudicate between release and refund.</p>
        <label className="label">Reason</label>
        <textarea className="input" rows={3} placeholder="Describe what went wrong…" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  )
}

export default BuyerOrder
