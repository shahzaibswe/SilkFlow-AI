import { useCallback, useEffect, useRef, useState } from 'react'

// useAsync(fn, deps) -> { data, loading, error, reload, setData }
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(immediate)
  const [error, setError] = useState(null)
  const mounted = useRef(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fnRef.current()
      if (mounted.current) setData(res)
      return res
    } catch (e) {
      if (mounted.current) setError(e.message || String(e))
      return null
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => { if (immediate) run() /* eslint-disable-next-line */ }, deps)

  return { data, loading, error, reload: run, setData }
}

// Poll a fetcher every `ms`, pausing when the tab is hidden.
export function usePoll(fn, ms = 5000, deps = []) {
  const { data, loading, error, reload, setData } = useAsync(fn, deps)
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) reload() }, ms)
    return () => clearInterval(id)
  }, [ms, reload])
  return { data, loading, error, reload, setData }
}
