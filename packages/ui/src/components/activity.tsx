import * as React from "react"

function createActivityStore() {
  const pending = new Map<symbol, string | null>()
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
    getBlockingSnapshot: () => [...pending.values()].find((label) => label !== null) ?? null,
    begin(label: string | null) {
      const token = Symbol()
      pending.set(token, label)
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
    if (active) return store?.begin(null)
  }, [active, store])
  return store !== null
}

/** Blocks interaction only for work whose owner cannot safely accept more input. */
export function useReportBlockingActivity(active: boolean, label: string) {
  const store = React.useContext(ActivityContext)
  React.useLayoutEffect(() => {
    if (active) return store?.begin(label)
  }, [active, label, store])
  return store !== null
}

const noBlockingActivity = () => null

export function useBlockingActivity() {
  const store = React.useContext(ActivityContext)
  return React.useSyncExternalStore(
    store?.subscribe ?? subscribeIdle,
    store?.getBlockingSnapshot ?? noBlockingActivity,
    noBlockingActivity,
  )
}

export function useActivityPending() {
  const store = React.useContext(ActivityContext)
  return React.useSyncExternalStore(
    store?.subscribe ?? subscribeIdle,
    store?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  )
}
