import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth, landingFor } from '../../auth'
import { Logo } from '../../components/Logo'
import { Spinner } from '../../components/Spinner'
import { useToast } from '../../components/Toast'

const DEMO_ACCOUNTS = [
  { email: 'seller@coretech.io', role: 'Exporter', icon: '🏭' },
  { email: 'buyer@globalmart.pk', role: 'Buyer', icon: '🛒' },
  { email: 'reviewer@coretech.io', role: 'Reviewer', icon: '🔍' },
  { email: 'admin@coretech.io', role: 'Admin', icon: '🛡️' },
]

export function Login() {
  const { login, user } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  if (user) { nav(landingFor(user.role), { replace: true }); return null }

  const submit = async (e) => {
    e?.preventDefault()
    setBusy(true); setErr(null)
    try {
      const d = await login(email.trim(), password)
      toast.success(`Welcome back, ${d.user.name}`)
      nav(loc.state?.from || landingFor(d.role), { replace: true })
    } catch (ex) {
      setErr(ex.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  const quickLogin = (acct) => { setEmail(acct.email); setPassword('Password123!'); submitQuick(acct.email) }
  const submitQuick = async (em) => {
    setBusy(true); setErr(null)
    try {
      const d = await login(em, 'Password123!')
      toast.success(`Signed in as ${d.user.name} (${d.role})`)
      nav(landingFor(d.role), { replace: true })
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-3 max-w-xs text-sm text-slate-400 text-balance">
            AI copilot for cross-border trade finance — escrow, scoring and audit, unified.
          </p>
        </div>

        <form onSubmit={submit} className="card-pad space-y-5">
          <div>
            <h1 className="text-lg font-bold text-white">Sign in</h1>
            <p className="text-sm text-slate-400">Access your SilkFlow portal.</p>
          </div>

          {err && <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" className="input" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="password">Password</label>
              <button type="button" onClick={() => toast.info('demo: use Password123!')} className="mb-1.5 text-xs font-medium text-gold hover:underline">Forgot password?</button>
            </div>
            <div className="relative">
              <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" className="input pr-16" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-slate-200">{show ? 'Hide' : 'Show'}</button>
            </div>
          </div>

          <button type="submit" className="btn-gold w-full" disabled={busy}>
            {busy && <Spinner size={16} className="text-navy-950" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-center text-sm text-slate-400">
            New business? <Link to="/register" className="font-semibold text-gold hover:underline">Create account</Link>
          </p>
        </form>

        <div className="mt-6">
          <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">One-click demo accounts · Password123!</p>
          <div className="grid grid-cols-2 gap-2.5">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                onClick={() => quickLogin(a)}
                disabled={busy}
                className="group flex items-center gap-2.5 rounded-lg border border-white/10 bg-navy-800/60 px-3 py-2.5 text-left hover:border-gold/40 hover:bg-navy-800 disabled:opacity-50"
              >
                <span className="text-lg">{a.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-100">{a.role}</span>
                  <span className="block truncate text-[11px] text-slate-500">{a.email}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">Demo: seller@coretech.io / Password123!</p>
      </div>
    </div>
  )
}

export default Login
