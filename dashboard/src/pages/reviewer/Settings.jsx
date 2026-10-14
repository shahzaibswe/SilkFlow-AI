import { useEffect, useState } from 'react'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { ConfirmModal } from '../../components/Modal'
import { Spinner } from '../../components/Spinner'
import { fmtNum } from '../../utils'

export function Settings() {
  const toast = useToast()
  const { data, loading, reload, setData } = useAsync(() => api.getSettings(), [])

  const [form, setForm] = useState({ auto_release_limit: '', reviewer_threshold_score: '' })
  const [saving, setSaving] = useState(false)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [confirmKill, setConfirmKill] = useState(false)

  useEffect(() => {
    if (data) setForm({
      auto_release_limit: String(data.auto_release_limit ?? ''),
      reviewer_threshold_score: String(data.reviewer_threshold_score ?? ''),
    })
  }, [data])

  const paused = !!data?.kill_switch || data?.agent_state === 'paused'

  const save = async (e) => {
    e?.preventDefault()
    setSaving(true)
    try {
      const res = await api.putSettings({
        auto_release_limit: Number(form.auto_release_limit) || 0,
        reviewer_threshold_score: Number(form.reviewer_threshold_score) || 0,
      })
      setData(res)
      toast.success('Policy limits saved')
    } catch (ex) {
      toast.error(ex.message || 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  const toggleKill = async () => {
    setConfirmKill(false)
    setToggleBusy(true)
    try {
      const res = paused ? await api.resumeAgent() : await api.pauseAgent()
      const fresh = await api.getSettings()
      setData(fresh)
      toast[res.kill_switch || res.agent_state === 'paused' ? 'warn' : 'success'](
        res.agent_state === 'paused' ? 'Kill switch ENGAGED — agent paused' : 'Agent resumed — automation active'
      )
      await reload()
    } catch (ex) {
      toast.error(ex.message || 'Toggle failed')
    } finally {
      setToggleBusy(false)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="Agent policy and safety controls…" />
        <div className="grid gap-6 lg:grid-cols-2"><div className="card-pad skeleton h-72" /><div className="card-pad skeleton h-72" /></div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Agent policy limits and global safety controls." />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Policy form */}
        <form onSubmit={save} className="card-pad">
          <h2 className="mb-4 section-title">Release policy</h2>

          <div className="space-y-4">
            <div>
              <label className="label">Auto-release limit (USD)</label>
              <input type="number" min="0" step="500" className="input" value={form.auto_release_limit} onChange={(e) => setForm((f) => ({ ...f, auto_release_limit: e.target.value }))} />
              <p className="mt-1 text-xs text-slate-500">Orders above this amount require a human to release escrow. Currently {fmtNum(data?.auto_release_limit)}.</p>
            </div>

            <div>
              <label className="label">Reviewer threshold score</label>
              <input type="number" min="0" max="100" className="input" value={form.reviewer_threshold_score} onChange={(e) => setForm((f) => ({ ...f, reviewer_threshold_score: e.target.value }))} />
              <p className="mt-1 text-xs text-slate-500">Trades scoring below this are escalated to the reviewer queue instead of auto-approved.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-navy-900/40 px-3 py-2.5">
                <p className="text-xs text-slate-500">Max release per order</p>
                <p className="mt-0.5 text-lg font-bold text-white">{data?.max_release_per_order ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-navy-900/40 px-3 py-2.5">
                <p className="text-xs text-slate-500">Agent state</p>
                <p className={`mt-0.5 text-lg font-bold ${paused ? 'text-red-300' : 'text-emerald-300'}`}>{data?.agent_state || (paused ? 'paused' : 'active')}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end border-t border-white/10 pt-4">
            <button type="submit" className="btn-gold" disabled={saving}>
              {saving && <Spinner size={16} className="text-navy-950" />}
              {saving ? 'Saving…' : 'Save policy'}
            </button>
          </div>
        </form>

        {/* Kill switch */}
        <div className="space-y-6">
          <div className={`card-pad border-2 ${paused ? 'border-red-500/50 bg-red-500/10' : 'border-white/10'}`}>
            <h2 className="mb-2 section-title">Kill switch</h2>
            <p className="text-sm text-slate-400">Instantly pauses every automated agent action across all orders — approvals, holds and fund releases stop immediately.</p>

            <div className="my-6 flex items-center justify-center">
              <button
                onClick={() => setConfirmKill(true)}
                disabled={toggleBusy}
                className={`relative flex h-16 w-full max-w-xs items-center justify-between rounded-2xl border-2 px-6 font-bold uppercase tracking-wider transition disabled:opacity-60 ${paused ? 'border-red-500 bg-red-600/20 text-red-300' : 'border-emerald-400/40 bg-navy-900/60 text-slate-400 hover:border-red-400/40'}`}
              >
                <span>Agent</span>
                <span className="flex items-center gap-2">
                  {toggleBusy && <Spinner size={16} />}
                  {paused ? 'Paused' : 'Active'}
                  <span className={`flex h-8 w-16 items-center rounded-full px-1 transition ${paused ? 'justify-end bg-red-500' : 'justify-start bg-white/10'}`}>
                    <span className="h-6 w-6 rounded-full bg-white shadow" />
                  </span>
                </span>
              </button>
            </div>

            <div className={`rounded-lg border px-3 py-2 text-center text-sm font-semibold ${paused ? 'border-red-400/40 bg-red-500/15 text-red-300' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'}`}>
              {paused ? '⚠ KILL SWITCH ENGAGED — automation halted' : '✓ Automation running normally'}
            </div>

            <div className="mt-4 flex justify-end">
              <button className={paused ? 'btn-gold btn-sm' : 'btn-danger btn-sm'} onClick={() => setConfirmKill(true)} disabled={toggleBusy}>
                {paused ? 'Resume agent' : 'Engage kill switch'}
              </button>
            </div>
          </div>

          <div className="card-pad">
            <h2 className="mb-2 section-title">How the agent decides</h2>
            <ul className="space-y-1.5 text-sm text-slate-400">
              <li>• Kill switch on → <span className="text-slate-200">hold</span> (no action).</li>
              <li>• Doc check fails or anomaly → <span className="text-slate-200">escalate / hold</span>.</li>
              <li>• Score below reviewer threshold → <span className="text-slate-200">escalate</span>.</li>
              <li>• No shipment evidence → <span className="text-slate-200">hold</span>.</li>
              <li>• Amount above auto-release limit → <span className="text-slate-200">escalate for human release</span>.</li>
              <li>• Otherwise → <span className="text-emerald-300">release</span> (exactly once per order).</li>
            </ul>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmKill}
        onClose={() => setConfirmKill(false)}
        onConfirm={toggleKill}
        loading={toggleBusy}
        tone={paused ? 'gold' : 'danger'}
        title={paused ? 'Resume the agent?' : 'Engage kill switch?'}
        confirmLabel={paused ? 'Resume agent' : 'Engage kill switch'}
        message={paused
          ? 'This re-enables automated approvals, holds and fund releases across all live orders. Continue?'
          : 'This immediately HALTS all automated agent actions platform-wide. Orders will queue for manual review until resumed. Continue?'}
      />
    </div>
  )
}

export default Settings
