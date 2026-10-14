import { useState } from 'react'
import api from '../../api'
import { useAsync } from '../../hooks'
import { useToast } from '../../components/Toast'
import { PageHeader } from '../../components/PageHeader'
import { DataTable } from '../../components/DataTable'
import { Spinner } from '../../components/Spinner'
import { fmtDate } from '../../utils'

const ROLE_CLS = {
  exporter: 'border-sky-400/30 bg-sky-500/15 text-sky-300',
  buyer: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300',
  reviewer: 'border-violet-400/30 bg-violet-500/15 text-violet-300',
  admin: 'border-gold/40 bg-gold/15 text-gold',
}

export function Users() {
  const toast = useToast()
  const { data, loading, reload } = useAsync(() => api.listUsers(), [])
  const users = data?.users || []

  const [busy, setBusy] = useState(null)

  const setStatus = async (u, status) => {
    setBusy(u.id)
    try {
      await api.patchUser(u.id, { status })
      toast.success(`${u.name} ${status === 'suspended' ? 'suspended' : 'reactivated'}`)
      await reload()
    } catch (ex) {
      toast.error(ex.message || 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  const columns = [
    {
      key: 'name', header: 'User', sortable: true,
      render: (u) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/15 text-xs font-bold text-gold">{(u.name || '?').slice(0, 1)}</span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-100">{u.name}</div>
            <div className="truncate text-xs text-slate-500">{u.email}</div>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', sortable: true, render: (u) => <span className={`chip border capitalize ${ROLE_CLS[u.role] || 'border-white/10 text-slate-300'}`}>{u.role}</span> },
    {
      key: 'status', header: 'Status', render: (u) => (
        <span className={`chip border ${u.status === 'active' ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300' : 'border-red-400/30 bg-red-500/15 text-red-300'}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />{u.status}
        </span>
      ),
    },
    { key: 'created_at', header: 'Joined', sortable: true, align: 'right', render: (u) => <span className="text-xs text-slate-400">{fmtDate(u.created_at)}</span> },
    {
      key: 'action', header: '', align: 'right',
      render: (u) => (
        busy === u.id
          ? <Spinner size={16} />
          : u.status === 'active'
            ? <button className="btn-danger btn-sm" onClick={() => setStatus(u, 'suspended')}>Suspend</button>
            : <button className="btn-primary btn-sm" onClick={() => setStatus(u, 'active')}>Activate</button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="Users" subtitle="Manage account access across exporters, buyers and reviewers." />
      <DataTable columns={columns} data={users} loading={loading} searchKeys={['name', 'email', 'role', 'status']} rowKey={(u) => u.id} />
    </div>
  )
}

export default Users
