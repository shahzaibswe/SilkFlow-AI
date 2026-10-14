import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth, RequireRole, landingFor } from './auth'
import { Layout } from './components/Layout'

import { Login } from './pages/auth/Login'
import { Register } from './pages/auth/Register'
import { Profile } from './pages/Profile'

import { OrdersList } from './pages/exporter/OrdersList'
import { NewOrder } from './pages/exporter/NewOrder'
import { OrderDetail } from './pages/exporter/OrderDetail'
import { Payments } from './pages/exporter/Payments'
import { Dashboard } from './pages/exporter/Dashboard'
import { CashFlow } from './pages/exporter/CashFlow'
import { Copilot } from './pages/exporter/Copilot'

import { Inbox } from './pages/buyer/Inbox'
import { BuyerOrder } from './pages/buyer/BuyerOrder'

import { Feed } from './pages/reviewer/Feed'
import { Cases } from './pages/reviewer/Cases'
import { CaseDetail } from './pages/reviewer/CaseDetail'
import { AuditTrail } from './pages/reviewer/AuditTrail'
import { Reports } from './pages/reviewer/Reports'
import { Models } from './pages/reviewer/Models'
import { Settings } from './pages/reviewer/Settings'
import { Users } from './pages/reviewer/Users'

function RoleGate({ roles, children }) {
  const { role } = useAuth()
  // A logged-in user hitting a portal they don't belong to → their own landing.
  if (role && !roles.includes(role)) return <Navigate to={landingFor(role)} replace />
  return children
}

function LandingRedirect() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={landingFor(user.role)} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<RequireRole roles={null}><Layout /></RequireRole>}>
        <Route element={<RequireRole />}>
          <Route index element={<LandingRedirect />} />
          <Route path="/profile" element={<Profile />} />

          {/* Exporter portal */}
          <Route path="/dashboard" element={<RoleGate roles={['exporter']}><Dashboard /></RoleGate>} />
          <Route path="/orders" element={<RoleGate roles={['exporter']}><OrdersList /></RoleGate>} />
          <Route path="/orders/new" element={<RoleGate roles={['exporter']}><NewOrder /></RoleGate>} />
          <Route path="/payments" element={<RoleGate roles={['exporter']}><Payments /></RoleGate>} />
          <Route path="/cash-flow" element={<RoleGate roles={['exporter']}><CashFlow /></RoleGate>} />

          {/* SME copilot chat — exporters plus reviewer/admin (who scope it by business) */}
          <Route path="/copilot" element={<RoleGate roles={['exporter', 'reviewer', 'admin']}><Copilot /></RoleGate>} />

          {/* Buyer portal */}
          <Route path="/inbox" element={<RoleGate roles={['buyer']}><Inbox /></RoleGate>} />

          {/* Shared order detail — component swaps by role */}
          <Route path="/orders/:id" element={<OrderDetailByRole />} />

          {/* Reviewer / Admin console */}
          <Route path="/feed" element={<RoleGate roles={['reviewer', 'admin']}><Feed /></RoleGate>} />
          <Route path="/cases" element={<RoleGate roles={['reviewer', 'admin']}><Cases /></RoleGate>} />
          <Route path="/cases/:id" element={<RoleGate roles={['reviewer', 'admin']}><CaseDetail /></RoleGate>} />
          <Route path="/audit" element={<RoleGate roles={['reviewer', 'admin']}><AuditTrail /></RoleGate>} />
          <Route path="/reports" element={<RoleGate roles={['reviewer', 'admin']}><Reports /></RoleGate>} />
          <Route path="/models" element={<RoleGate roles={['reviewer', 'admin']}><Models /></RoleGate>} />
          <Route path="/settings" element={<RoleGate roles={['reviewer', 'admin']}><Settings /></RoleGate>} />
          <Route path="/admin/users" element={<RoleGate roles={['admin']}><Users /></RoleGate>} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function OrderDetailByRole() {
  const { role } = useAuth()
  if (role === 'buyer') return <BuyerOrder />
  return <OrderDetail />
}
