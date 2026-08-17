import { useEffect, useState } from 'react'
import type { SearchResult } from '../types'

type UseFootageSearchOptions = {
  projectId: string | null
  query: string
  kind?: 'all' | 'frame' | 'transcript'
  debounceMs?: number
}

export function useFootageSearch({
  projectId,
  query,
  kind = 'all',
  debounceMs = 300,
}: UseFootageSearchOptions) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalIndexed, setTotalIndexed] = useState<number>(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (!projectId || trimmed.length < 2) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    const timer = setTimeout(async () => {
      try {
        const url = `/v1/projects/${encodeURIComponent(projectId)}/search?q=${encodeURIComponent(trimmed)}&kind=${kind}&top_k=20`
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`Search failed: HTTP ${res.status}`)
        }
        const data = await res.json()
        setResults(data.results || [])
        setTotalIndexed(data.total || 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Footage search failed')
      } finally {
        setLoading(false)
      }
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [projectId, query, kind, debounceMs])

  return { results, loading, error, totalIndexed }
}
