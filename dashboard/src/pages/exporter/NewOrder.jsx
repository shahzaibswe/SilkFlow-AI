import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'PKR', 'CNY']

export function NewOrder() {
  const nav = useNavigate()
  const toast = useToast()
  const { data: buyersData } = useAsync(() => api.buyers().catch(() => null), [])
  const buyers = buyersData?.businesses || buyersData?.users?.filter((u) => u.role === 'buyer') || []

  const [form, setForm] = useState({
    buyer_id: '', goods: '', quantity: '', amount: '', currency: 'USD', payment_term_days: '30', ship_by: '',
  })
  const [invoice, setInvoice] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const useList = buyers.length > 0

  const submit = async (e) => {
    e.preventDefault()
    if (!form.buyer_id || !form.goods || !form.amount) { toast.error('Please fill buyer, goods and amount'); return }
    setBusy(true)
    try {
      const order = await api.createOrder({
        buyer_id: Number(form.buyer_id),
        goods: form.goods,
        quantity: Number(form.quantity) || 1,
        amount: Number(form.amount),
        currency: form.currency,
        payment_term_days: Number(form.payment_term_days) || 30,
        ship_by: form.ship_by || undefined,
      })
      if (invoice) {
        const fd = new FormData()
        fd.append('file', invoice)
        fd.append('type', 'invoice')
        await api.uploadDocument(order.id, fd).catch(() => toast.warn('Order created but invoice upload failed'))
      }
      toast.success(`Order #${String(order.id).padStart(5, '0')} created`)
      nav(`/orders/${order.id}`)
    } catch (ex) {
      toast.error(ex.message || 'Could not create order')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New order" subtitle="Create a trade order and invite the buyer to fund escrow." back="/orders" />

      <form onSubmit={submit} className="card-pad space-y-6">
        <div>
          <label className="label">Buyer</label>
          {useList ? (
            <select className="input" value={form.buyer_id} onChange={set('buyer_id')} required>
              <option value="">Select a buyer…</option>
              {buyers.map((b) => <option key={b.id} value={b.id}>{b.legal_name || b.name} {b.country ? `· ${b.country}` : ''}</option>)}
            </select>
          ) : (
            <>
              <input type="number" min="1" className="input" placeholder="Buyer business ID" value={form.buyer_id} onChange={set('buyer_id')} required />
              <p className="mt-1 text-xs text-slate-500">Enter the buyer's numeric business ID (assigned at KYB). Tip: demo buyers are 3 (GlobalMart) and 4 (GlobalMart II).</p>
            </>
          )}
        </div>

        <div>
          <label className="label">Goods description</label>
          <input className="input" placeholder="e.g. Cotton bed linens" value={form.goods} onChange={set('goods')} required />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Quantity</label>
            <input type="number" min="1" className="input" placeholder="500" value={form.quantity} onChange={set('quantity')} />
          </div>
          <div>
            <label className="label">Invoice amount</label>
            <div className="flex gap-2">
              <input type="number" min="0" step="0.01" className="input flex-1" placeholder="18000" value={form.amount} onChange={set('amount')} required />
              <select className="input w-28" value={form.currency} onChange={set('currency')}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Payment term (days)</label>
            <input type="number" min="0" className="input" value={form.payment_term_days} onChange={set('payment_term_days')} />
          </div>
          <div>
            <label className="label">Ship by</label>
            <input type="date" className="input" value={form.ship_by} onChange={set('ship_by')} />
          </div>
        </div>

        <div>
          <label className="label">Invoice upload <span className="normal-case text-slate-600">(optional — PDF/CSV/TXT)</span></label>
          <label className={`flex cursor-pointer items-center gap-3 rounded-lg border border-dashed ${invoice ? 'border-emerald-400/40 bg-emerald-500/5' : 'border-white/15 bg-navy-900/40 hover:border-gold/40'} px-4 py-4`}>
            <span className="text-2xl">{invoice ? '📄' : '⬆'}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{invoice ? invoice.name : 'Click to attach invoice'}</p>
              <p className="text-xs text-slate-500">{invoice ? `${(invoice.size / 1024).toFixed(0)} KB ready to upload` : 'Attaches to the order as the invoice document'}</p>
            </div>
            <input type="file" accept=".pdf,.txt,.csv" className="hidden" onChange={(e) => setInvoice(e.target.files[0] || null)} />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
          <Link to="/orders" className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-gold" disabled={busy}>
            {busy && <Spinner size={16} className="text-navy-950" />}
            {busy ? 'Creating…' : 'Create order'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default NewOrder
