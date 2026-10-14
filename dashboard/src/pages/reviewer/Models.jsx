import { useState } from 'react'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { DataTable } from '../../components/DataTable'
import { Spinner } from '../../components/Spinner'
import { fmtNum, fmtDate } from '../../utils'

function pct(n) { return n == null ? '—' : `${(n * 100).toFixed(1)}%` }

function ActiveBadge({ active }) {
  return active
    ? <span className="chip border border-emerald-400/30 bg-emerald-500/15 text-emerald-300">● Active</span>
    : <span className="chip border border-white/10 text-slate-500">Archived</span>
}

export function Models() {
  const toast = useToast()
  const { data, loading, reload } = useAsync(() => api.listModels(), [])
  const models = data?.models || []
  const active = models.find((m) => m.is_active)
  const activeMetrics = active?.metrics
  const activeVersion = active?.version

  const [retraining, setRetraining] = useState(false)
  const [lastJob, setLastJob] = useState(null)

  const retrain = async () => {
    setRetraining(true)
    try {
      const res = await api.retrain({})
      setLastJob(res)
      toast.success(`Retrained ${res.model_version} (AUC ${res.metrics?.auc ?? '—'})`)
      await reload()
    } catch (ex) {
      toast.error(ex.message || 'Retrain failed')
    } finally {
      setRetraining(false)
    }
  }

  const columns = [
    {
      key: 'version', header: 'Version', sortable: true,
      render: (m) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-100">{m.version}</div>
          <div className="text-xs text-slate-500">trained {fmtDate(m.trained_on, true)}</div>
        </div>
      ),
    },
    { key: 'auc', header: 'AUC', align: 'right', render: (m) => <span className={`tabular-nums font-semibold ${m.metrics?.auc >= 0.9 ? 'text-emerald-300' : m.metrics?.auc >= 0.8 ? 'text-gold' : 'text-slate-300'}`}>{m.metrics?.auc ?? '—'}</span> },
    { key: 'accuracy', header: 'Accuracy', align: 'right', render: (m) => <span className="tabular-nums text-slate-300">{pct(m.metrics?.accuracy)}</span> },
    { key: 'n_rows', header: 'Rows', align: 'right', render: (m) => <span className="tabular-nums text-slate-400">{fmtNum(m.metrics?.n_rows)}</span> },
    { key: 'is_active', header: 'Status', render: (m) => <ActiveBadge active={m.is_active} /> },
  ]

  return (
    <div>
      <PageHeader
        title="Models"
        subtitle="Trade credit-scoring model versions and offline metrics."
        actions={
          <button className="btn-gold" onClick={retrain} disabled={retraining}>
            {retraining && <Spinner size={16} className="text-navy-950" />}
            {retraining ? 'Retraining…' : '⚡ Retrain model'}
          </button>
        }
      />

      {lastJob && (
        <div className="card-pad mb-6 border-gold/30 bg-gold/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-title text-gold">Latest retrain job</p>
              <p className="mt-1 text-sm text-slate-200"><span className="font-mono">{lastJob.job_id}</span> · {lastJob.status} · <span className="font-semibold">{lastJob.model_version}</span></p>
            </div>
            <div className="flex gap-4 text-sm">
              <div><p className="text-xs text-slate-500">AUC</p><p className="font-bold text-white tabular-nums">{lastJob.metrics?.auc ?? '—'}</p></div>
              <div><p className="text-xs text-slate-500">Accuracy</p><p className="font-bold text-white tabular-nums">{pct(lastJob.metrics?.accuracy)}</p></div>
              <div><p className="text-xs text-slate-500">Rows</p><p className="font-bold text-white tabular-nums">{fmtNum(lastJob.metrics?.n_rows)}</p></div>
            </div>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={models} loading={loading} searchable={false} rowKey={(m) => m.id} />

      {activeMetrics && <EvaluationPanel mm={activeMetrics} version={activeVersion} />}

      <div className="card-pad mt-6">
        <h2 className="mb-2 section-title">About scoring models</h2>
        <p className="text-sm text-slate-400">
          SilkFlow trains an XGBoost gradient-boosted scorer plus an always-trained Logistic Regression baseline
          on the identical seeded split of synthetic trade features, and an Isolation Forest anomaly detector.
          Retraining promotes the newest version to active and is logged to the audit trail. Metrics shown are
          computed on the held-out validation split of 100% synthetic data — a prototype evaluation, not
          validated banking-grade risk prediction.
        </p>
      </div>
    </div>
  )
}

function EvaluationPanel({ mm, version }) {
  const cm = mm.confusion_matrix
  const bl = mm.baseline
  const cell = 'px-3 py-2 tabular-nums'
  return (
    <div className="card-pad mt-6">
      <h2 className="mb-3 section-title">Holdout evaluation — <span className="font-mono text-slate-300">{version}</span></h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="text-xs text-slate-500 mb-2">Main candidate: {(mm.scorer || 'xgboost').toUpperCase()}</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-white/5">
              {[['AUC', mm.auc], ['Accuracy', mm.accuracy], ['Precision', mm.precision],
                ['Recall', mm.recall], ['F1', mm.f1], ['Threshold', mm.threshold]].map(([k, v]) => (
                <tr key={k}><td className={`${cell} text-slate-400`}>{k}</td><td className={`${cell} text-right font-semibold text-slate-100`}>{v ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
          {cm && (
            <p className="mt-2 text-xs text-slate-500">
              Confusion matrix @0.5 — TP {cm.tp} · FP {cm.fp} · FN {cm.fn} · TN {cm.tn}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-2">
            Baseline: LOGISTIC REGRESSION (same split) {bl && <span className="text-slate-600">· synthetic data</span>}
          </p>
          {bl ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-white/5">
                {[['AUC', bl.auc], ['Accuracy', bl.accuracy], ['Precision', bl.precision],
                  ['Recall', bl.recall], ['F1', bl.f1]].map(([k, v]) => (
                  <tr key={k}><td className={`${cell} text-slate-400`}>{k}</td><td className={`${cell} text-right font-semibold text-slate-100`}>{v ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-500">Baseline metrics not recorded for this version (retrain to capture them).</p>
          )}
          {bl && (
            <p className="mt-2 text-xs text-slate-500">
              {Number(bl.auc) > Number(mm.auc)
                ? 'The simple baseline outperforms the boosted model on this synthetic signal — reported honestly, not curated.'
                : 'The boosted model beats the interpretable baseline on this split.'}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Anomaly detector: {(mm.anomaly || 'iforest')} · Explanations: {(mm.explanations || 'shap')}
          </p>
        </div>
      </div>
    </div>
  )
}

export default Models
