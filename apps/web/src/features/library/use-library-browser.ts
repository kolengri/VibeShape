import type { AssemblyLibraryItem } from "@vibeshape/domain/assembly-library"
import { useEffect, useRef, useState } from "react"
import { listLocalLibraryItems, readLocalLibraryVersion } from "../../document/library-controller"
import { type LibrarySelection, librarySelection } from "./library-model"

export function useLibraryBrowser(failed: string) {
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<readonly AssemblyLibraryItem[]>([])
  const [selection, setSelection] = useState<LibrarySelection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const searchGeneration = useRef(0),
    readGeneration = useRef(0)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    const generation = ++searchGeneration.current
    const timer = setTimeout(() => {
      setLoading(true)
      void listLocalLibraryItems(query)
        .then((result) => {
          if (!active.current || generation !== searchGeneration.current) return
          if (result.ok) {
            setItems(result.value)
            setError(null)
          } else {
            setItems([])
            setError(result.diagnostic.message)
          }
        })
        .catch(() => {
          if (active.current && generation === searchGeneration.current) setError(failed)
        })
        .finally(() => {
          if (active.current && generation === searchGeneration.current) setLoading(false)
        })
    }, 150)
    return () => {
      clearTimeout(timer)
      ++searchGeneration.current
    }
  }, [query, refresh, failed])
  const select = async (itemId: string, version?: number) => {
    const generation = ++readGeneration.current
    setSelection(null)
    setError(null)
    setLoading(true)
    try {
      const result = await readLocalLibraryVersion(itemId, version)
      if (!active.current || generation !== readGeneration.current) return
      if (result.ok) setSelection(librarySelection(result.value))
      else setError(result.diagnostic.message)
    } catch {
      if (active.current && generation === readGeneration.current) setError(failed)
    } finally {
      if (active.current && generation === readGeneration.current) setLoading(false)
    }
  }
  return {
    query,
    setQuery,
    items,
    selection,
    setSelection,
    error,
    loading,
    select,
    reload: () => setRefresh((value) => value + 1),
  }
}
export type LibraryBrowser = ReturnType<typeof useLibraryBrowser>
