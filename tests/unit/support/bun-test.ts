import { type Mock, vi as native, setSystemTime } from "bun:test"
import { type Clock, type Config, install, timers } from "@sinonjs/fake-timers"

const globalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()
const windowDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()
const environmentValues = new Map<string, string | undefined>()
const accessorRestorations = new Set<() => void>()
const realSetTimeout = globalThis.setTimeout
let clock: Clock | undefined

function activeClock() {
  if (!clock) throw new Error("Fake timers are not installed.")
  return clock
}

function spyOn<T extends object, K extends keyof T>(
  object: T,
  property: K,
): Mock<Extract<T[K], (...args: never[]) => unknown>>
function spyOn<T extends object, K extends keyof T>(
  object: T,
  property: K,
  access: "get",
): Mock<() => T[K]>
function spyOn<T extends object, K extends keyof T>(
  object: T,
  property: K,
  access: "set",
): Mock<(value: T[K]) => void>
function spyOn(object: object, property: PropertyKey, access?: "get" | "set") {
  if (!access) return native.spyOn(object, property as never)
  let owner: object | null = object
  while (owner && !Object.hasOwn(owner, property)) owner = Object.getPrototypeOf(owner)
  const descriptor = owner ? Object.getOwnPropertyDescriptor(owner, property) : undefined
  const implementation = descriptor?.[access]
  if (!descriptor || !implementation)
    throw new Error(`Missing ${access} accessor: ${String(property)}`)
  const own = Object.getOwnPropertyDescriptor(object, property)
  const spy = native.fn(implementation)
  Object.defineProperty(object, property, { ...descriptor, [access]: spy })
  const restore = () => {
    spy.mockReset()
    if (own) Object.defineProperty(object, property, own)
    else Reflect.deleteProperty(object, property)
    accessorRestorations.delete(restore)
  }
  accessorRestorations.add(restore)
  Object.defineProperty(spy, "mockRestore", { value: restore, configurable: true })
  return spy
}

function mocked<T extends (...args: never[]) => unknown>(value: T): Mock<T>
function mocked<T extends abstract new (...args: never[]) => unknown>(
  value: T,
): Mock<(...args: ConstructorParameters<T>) => InstanceType<T>>
function mocked(value: unknown) {
  return value
}

export const vi = {
  ...native,
  spyOn,
  restoreAllMocks() {
    native.restoreAllMocks()
    for (const restore of [...accessorRestorations].reverse()) restore()
  },
  mocked,
  stubGlobal(name: PropertyKey, value: unknown) {
    const browserWindow = Reflect.get(globalThis, "window") as object | undefined
    if (!globalDescriptors.has(name))
      globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    })
    if (browserWindow && browserWindow !== globalThis) {
      if (!windowDescriptors.has(name))
        windowDescriptors.set(name, Object.getOwnPropertyDescriptor(browserWindow, name))
      Object.defineProperty(browserWindow, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      })
    }
  },
  unstubAllGlobals() {
    for (const [name, descriptor] of globalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
    globalDescriptors.clear()
    const browserWindow = Reflect.get(globalThis, "window") as object | undefined
    if (browserWindow)
      for (const [name, descriptor] of windowDescriptors) {
        if (descriptor) Object.defineProperty(browserWindow, name, descriptor)
        else Reflect.deleteProperty(browserWindow, name)
      }
    windowDescriptors.clear()
  },
  stubEnv(name: string, value: string | boolean | undefined) {
    if (!environmentValues.has(name)) environmentValues.set(name, process.env[name])
    if (value === undefined || value === false) delete process.env[name]
    else process.env[name] = String(value)
  },
  unstubAllEnvs() {
    for (const [name, value] of environmentValues) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    environmentValues.clear()
  },
  useFakeTimers(options: Config = {}) {
    if (!clock)
      clock = install({
        now: Date.now(),
        toFake: Object.keys(timers).filter(
          (name) =>
            !["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"].includes(name),
        ) as NonNullable<Config["toFake"]>,
        ...options,
      })
    return vi
  },
  useRealTimers() {
    clock?.uninstall()
    clock = undefined
    setSystemTime()
    return vi
  },
  setSystemTime(now: number | Date) {
    if (clock) clock.setSystemTime(now)
    else setSystemTime(now)
  },
  advanceTimersByTime(milliseconds: number) {
    activeClock().tick(milliseconds)
    return vi
  },
  async advanceTimersByTimeAsync(milliseconds: number) {
    await activeClock().tickAsync(milliseconds)
    return vi
  },
  runAllTimers() {
    activeClock().runAll()
    return vi
  },
  clearAllTimers() {
    activeClock().reset()
    return vi
  },
  getTimerCount() {
    return activeClock().countTimers()
  },
  async waitFor<T>(
    callback: () => T | Promise<T>,
    options: number | { timeout?: number; interval?: number } = {},
  ) {
    const { timeout = 1000, interval = 50 } =
      typeof options === "number" ? { timeout: options } : options
    let elapsed = 0
    for (;;) {
      if (clock) await clock.tickAsync(interval)
      try {
        return await callback()
      } catch (error) {
        if (elapsed >= timeout) throw error
        await new Promise<void>((resolve) => realSetTimeout(resolve, interval))
        elapsed += interval
      }
    }
  },
}
