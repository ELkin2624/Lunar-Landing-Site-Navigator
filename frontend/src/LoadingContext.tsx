import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'

export interface LoadingContextValue {
  isLoading: boolean
  message: string
  startLoading: (key: string, message?: string) => void
  stopLoading: (key: string) => void
}

const LoadingContext = createContext<LoadingContextValue | null>(null)

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Map<string, string>>(() => new Map())

  const startLoading = useCallback((key: string, message?: string) => {
    setTasks(prev => {
      const next = new Map(prev)
      next.set(key, message ?? '')
      return next
    })
  }, [])

  const stopLoading = useCallback((key: string) => {
    setTasks(prev => {
      if (!prev.has(key)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }, [])

  const isLoading = tasks.size > 0
  const message = useMemo(() => {
    for (const msg of tasks.values()) {
      if (msg) return msg
    }
    return ''
  }, [tasks])

  const value = useMemo(
    () => ({ isLoading, message, startLoading, stopLoading }),
    [isLoading, message, startLoading, stopLoading]
  )

  return (
    <LoadingContext.Provider value={value}>
      {children}
    </LoadingContext.Provider>
  )
}

export function useLoading() {
  const context = useContext(LoadingContext)
  if (!context) {
    throw new Error('useLoading must be used within a LoadingProvider')
  }
  return context
}
