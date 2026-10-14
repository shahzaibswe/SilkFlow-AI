import { useAuth } from '../auth'
import { api } from '../api'
import { useAsync } from '../hooks'
import { PageHeader } from '../components/PageHeader'
import { Spinner } from '../components/Spinner'
import { HashLink } from '../components/HashLink'
import { fmtDate } from '../utils'

function Field({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2.5 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-100">{children}</span>
    </div>
  )
}

export function Profile() {
  const { user } = useAuth()
  const { data: biz, loading } = useAsync(() => api.myBusiness(), [])

  return (
    <div>
      <PageHeader title="Profile & business" subtitle="Your account details and registered entity." back=".." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card-pad">
          <h2 className="mb-3 section-title">Account</h2>
          <Field label="Name">{user?.name}</Field>
          <Field label="Email">{user?.email}</Field>
          <Field label="Role"><span className="capitalize">{user?.role}</span></Field>
        </div>

        <div className="card-pad">
          <h2 className="mb-3 section-title">Business (KYB)</h2>
          {loading ? <Spinner /> : biz ? (
            <>
              <Field label="Legal name">{biz.legal_name}</Field>
              <Field label="Country">{biz.country}</Field>
              <Field label="KYB status"><span className="chip border border-emerald-400/30 bg-emerald-500/15 text-emerald-300">{biz.kyb_status}</span></Field>
              <Field label="Wallet"><HashLink hash={biz.wallet_address} max={6} /></Field>
            </>
          ) : <p className="text-sm text-slate-500">No business profile on file.</p>}
        </div>
      </div>

      <div className="card-pad mt-6">
        <h2 className="mb-2 section-title">Session</h2>
        <p className="text-sm text-slate-400">Access token rotates automatically. Last authenticated: {fmtDate(new Date().toISOString(), true)}</p>
      </div>
    </div>
  )
}

export default Profile
