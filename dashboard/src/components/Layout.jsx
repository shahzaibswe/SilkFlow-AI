import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth, landingFor } from '../auth'
import { Logo } from './Logo'
import { AlertsBell } from './AlertsBell'
import { USE_FIXTURES, tokenStore } from '../api'

const NAV = {
  exporter: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/orders', label: 'Orders' },
    { to: '/orders/new', label: 'New Order' },
    { to: '/cash-flow', label: 'Cash Flow' },
    { to: '/copilot', label: 'Copilot' },
  ],
  buyer: [{ to: '/inbox', label: 'Order Inbox' }],
  reviewer: [
    { to: '/feed', label: 'Live Feed' },
    { to: '/cases', label: 'Case Queue' },
    { to: '/audit', label: 'Audit Trail' },
    { to: '/reports', label: 'Reports' },
    { to: '/copilot', label: 'Copilot' },
  ],
}
NAV.admin = [
  ...NAV.reviewer,
  { to: '/models', label: 'Models' },
  { to: '/settings', label: 'Settings' },
  { to: '/admin/users', label: 'Users' },
]

const ROLE_BADGE = {
  exporter: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
  buyer: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  reviewer: 'bg-violet-500/15 text-violet-300 border-violet-400/30',
  admin: 'bg-gold/15 text-gold border-gold/40',
}

export function Layout() {
  const { user, logout, role } = useAuth()
  const nav = useNavigate()
  const [menu, setMenu] = useState(false)
  const links = NAV[role] || []

  const doLogout = async () => {
    await logout()
    tokenStore.clear()
    nav('/login', { replace: true })
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-navy-900/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
          <NavLink to={landingFor(role)} className="shrink-0">
            <Logo size="sm" />
          </NavLink>

          <nav className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/orders' || l.to === '/feed'}
                className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {USE_FIXTURES && (
              <span className="hidden rounded-md border border-gold/30 bg-gold/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gold md:inline" title="Backend offline — serving fixtures">
                Demo data
              </span>
            )}
            <AlertsBell />
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-navy-800 px-2.5 py-1.5 hover:border-white/20">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/15 text-xs font-bold text-gold">
                  {(user?.name || '?').slice(0, 1)}
                </span>
                <span className="hidden text-sm font-medium text-slate-200 sm:inline">{user?.name}</span>
                <span className="text-slate-500">▾</span>
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-56 animate-fade-in rounded-xl border border-white/10 bg-navy-800 p-2 shadow-card">
                    <div className="border-b border-white/10 px-3 py-2.5">
                      <p className="truncate text-sm font-semibold text-white">{user?.name}</p>
                      <p className="truncate text-xs text-slate-400">{user?.email}</p>
                      <span className={`chip mt-2 border text-[10px] uppercase ${ROLE_BADGE[role]}`}>{role}</span>
                    </div>
                    <button onClick={() => { setMenu(false); nav('/profile') }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5">
                      Profile &amp; business
                    </button>
                    <button onClick={doLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-[1400px] px-6 pb-8 pt-4 text-center text-xs text-slate-600">
        SilkFlow AI · CoreTech Innovation · FinTechathon 2026 International Track — demo prototype
      </footer>
    </div>
  )
}

export default Layout
