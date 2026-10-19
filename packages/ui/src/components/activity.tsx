import * as React from "react"

function createActivityStore() {
  const pending = new Set<symbol>()
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => pending.size > 0,
    begin() {
      const token = Symbol()
      pending.add(token)
      notify()
      return () => {
        if (pending.delete(token)) notify()
      }
    },
  }
}

const ActivityContext = React.createContext<ReturnType<typeof createActivityStore> | null>(null)
const subscribeIdle = () => () => undefined
const idleSnapshot = () => false

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(createActivityStore)
  return <ActivityContext.Provider value={store}>{children}</ActivityContext.Provider>
}

/** Registers owned work without coupling its cancellation or action lock to presentation. */
export function useReportActivity(active: boolean) {
  const store = React.useContext(ActivityContext)
  React.useEffect(() => {
    if (active) return store?.begin()
  }, [active, store])
  return store !== null
}

export function useActivityPending() {
  const store = React.useContext(ActivityContext)
  return React.useSyncExternalStore(
    store?.subscribe ?? subscribeIdle,
    store?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  )
}
