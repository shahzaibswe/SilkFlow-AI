import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, landingFor } from '../../auth'
import { Logo } from '../../components/Logo'
import { Spinner } from '../../components/Spinner'
import { useToast } from '../../components/Toast'
import api from '../../api'

const ROLES = [
  { value: 'exporter', label: 'Exporter / Seller', desc: 'Create orders, upload docs, get paid' },
  { value: 'buyer', label: 'Buyer / Importer', desc: 'Review terms, fund escrow, confirm receipt' },
]

export function Register() {
  const { login } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'exporter' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.register(form)
      await login(form.email, form.password)
      toast.success('Account created — welcome to SilkFlow AI')
      nav(landingFor(form.role), { replace: true })
    } catch (ex) {
      setErr(ex.message || 'Registration failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center"><Logo size="lg" /></div>
        <form onSubmit={submit} className="card-pad space-y-5">
          <div>
            <h1 className="text-lg font-bold text-white">Create your account</h1>
            <p className="text-sm text-slate-400">Register a business on SilkFlow AI.</p>
          </div>

          {err && <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

          <div>
            <label className="label">Full name</label>
            <input className="input" placeholder="Jane Trader" value={form.name} onChange={set('name')} required />
          </div>
          <div>
            <label className="label">Work email</label>
            <input type="email" className="input" placeholder="you@company.com" value={form.email} onChange={set('email')} required />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" className="input" placeholder="min. 8 characters" value={form.password} onChange={set('password')} required minLength={6} />
          </div>
          <div>
            <label className="label">I am a…</label>
            <div className="grid grid-cols-2 gap-2.5">
              {ROLES.map((r) => (
                <button
                  type="button"
                  key={r.value}
                  onClick={() => setForm((f) => ({ ...f, role: r.value }))}
                  className={`rounded-lg border p-3 text-left transition ${form.role === r.value ? 'border-gold bg-gold/10' : 'border-white/10 bg-navy-900/50 hover:border-white/20'}`}
                >
                  <span className={`block text-sm font-semibold ${form.role === r.value ? 'text-gold' : 'text-slate-200'}`}>{r.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-slate-500">{r.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <button type="submit" className="btn-gold w-full" disabled={busy}>
            {busy && <Spinner size={16} className="text-navy-950" />}
            {busy ? 'Creating account…' : 'Create account'}
          </button>

          <p className="text-center text-sm text-slate-400">
            Already registered? <Link to="/login" className="font-semibold text-gold hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}

export default Register
