import { useMemo, useState } from 'react'
import { SkeletonRows } from './Skeleton'
import { EmptyState } from './EmptyState'

// columns: [{ key, header, sortable?, align?, render?(row), sortValue?(row) }]
export function DataTable({
  data = [], columns, loading = false, searchable = true, searchKeys,
  searchPlaceholder = 'Search…', onRowClick, empty = null, toolbar = null,
  rowKey = (r, i) => r.id ?? i, dense = false,
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState({ key: null, dir: 'asc' })

  const keys = searchKeys || columns.map((c) => c.key)

  const filtered = useMemo(() => {
    if (!q) return data
    const s = q.toLowerCase()
    return data.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(s)))
  }, [data, q, keys])

  const rows = useMemo(() => {
    if (!sort.key) return filtered
    const col = columns.find((c) => c.key === sort.key)
    const sv = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key])
    return [...filtered].sort((a, b) => {
      const av = sv(a), bv = sv(b)
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sort, columns])

  const toggleSort = (col) => {
    if (!col.sortable) return
    setSort((s) => (s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: 'asc' }))
  }

  return (
    <div className="card overflow-hidden">
      {(searchable || toolbar) && (
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          {searchable && (
            <div className="relative w-full sm:max-w-xs">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">⌕</span>
              <input className="input pl-9" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      <div className="overflow-x-auto">
        {loading ? (
          <div className="p-4"><SkeletonRows rows={5} /></div>
        ) : rows.length === 0 ? (
          <div className="p-6">{empty || <EmptyState title="No records" description="Nothing matches the current view." />}</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-navy-900/40 text-xs uppercase tracking-wider text-slate-400">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c)}
                    className={`px-4 py-3 font-semibold ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''} ${c.sortable ? 'cursor-pointer select-none hover:text-slate-200' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {c.sortable && <span className="text-[10px] opacity-60">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r, i) => (
                <tr
                  key={rowKey(r, i)}
                  onClick={() => onRowClick?.(r)}
                  className={`transition ${onRowClick ? 'cursor-pointer hover:bg-white/5' : 'hover:bg-white/[0.03]'} ${dense ? '' : ''}`}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''} ${c.cellClass || ''}`}>
                      {c.render ? c.render(r, i) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && rows.length > 0 && (
        <div className="border-t border-white/10 px-4 py-2.5 text-xs text-slate-500">
          {rows.length}{q ? ` of ${data.length}` : ''} record{rows.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}

export default DataTable
