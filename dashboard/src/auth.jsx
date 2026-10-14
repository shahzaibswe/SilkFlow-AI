// src/auth.jsx
// ---------------------------------------------------------------------------
// Auth context: stores tokens in localStorage, exposes login/logout, auto
// logs-out on 401 (via api.js event), plus RequireRole route guard and the
// role→landing-route mapping defined in API_SPEC §4.
// ---------------------------------------------------------------------------
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import api, { tokenStore } from './api'

const AuthCtx = createContext(null)

export const ROLE_LANDING = { exporter: '/orders', buyer: '/inbox', reviewer: '/feed', admin: '/feed' }
export function landingFor(role) { return ROLE_LANDING[role] || '/login' }

function decodeUser() {
  try {
    const t = tokenStore.access
    if (!t) return null
    const parts = t.split('.')
    if (parts.length < 2) return null
    const pl = JSON.parse(atob(parts[1]))
    if (!pl.sub && pl.role == null) return null
    return { id: pl.sub, role: pl.role, name: pl.name, email: pl.email }
  } catch { return null }
}

// Persist the full user object for nicer display; token is source of truth.
const LS_USER = 'silkflow.user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem(LS_USER)
    if (stored) { try { return JSON.parse(stored) } catch {} }
    return decodeUser()
  })

  const persistUser = (u) => {
    if (u) localStorage.setItem(LS_USER, JSON.stringify(u))
    else localStorage.removeItem(LS_USER)
    setUser(u)
  }

  const login = useCallback(async (email, password) => {
    const d = await api.login({ email, password })
    tokenStore.set(d)
    persistUser(d.user)
    return d
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() } catch {}
    tokenStore.clear()
    persistUser(null)
  }, [])

  useEffect(() => {
    const onUnauth = () => { tokenStore.clear(); persistUser(null) }
    window.addEventListener('silkflow:unauthorized', onUnauth)
    return () => window.removeEventListener('silkflow:unauthorized', onUnauth)
  }, [])

  const value = { user, role: user?.role || null, login, logout, isAuthenticated: !!user }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const c = useContext(AuthCtx)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}

// Route guard: requires a logged-in user whose role is in `roles`.
// Used either as a wrapper (<RequireRole>{el}</RequireRole>) or as a nested
// route element, in which case it must render the matched child via <Outlet/>.
export function RequireRole({ roles, children }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  if (roles && roles.length && !roles.includes(user.role)) {
    return <Navigate to={landingFor(user.role)} replace />
  }
  return children ?? <Outlet />
}
