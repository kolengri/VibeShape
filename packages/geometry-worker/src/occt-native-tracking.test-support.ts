import type { OpenCascadeInstance } from "replicad-opencascadejs"

type Deletable = { delete(): unknown }
type Callable = (...values: unknown[]) => unknown
type Constructible = new (...values: unknown[]) => unknown

function isDeletable(value: unknown): value is Deletable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { delete?: unknown }).delete === "function"
  )
}

/**
 * Wraps the kernel so every native wrapper it hands out (constructed, returned by a static
 * function, or returned by an instance method such as `TopExp_Explorer.Current()`) is counted
 * until its `delete()`. Embind receives the unwrapped targets, so native type checks still apply.
 */
export function trackNativeWrappers(kernel: OpenCascadeInstance) {
  const targets = new WeakMap<object, object>()
  let live = 0
  const sites = new Map<object, string>()
  const unwrap = (value: unknown) =>
    typeof value === "object" && value !== null ? (targets.get(value) ?? value) : value
  const track = (value: unknown): unknown => {
    if (!isDeletable(value)) return value
    live += 1
    let released = false
    const site = new Error().stack?.split("\n").slice(2, 5).join(" <- ") ?? ""
    sites.set(value, site)
    const proxy = new Proxy(value, {
      get(target, key) {
        const property = Reflect.get(target, key, target)
        if (key === "delete")
          return () => {
            if (!released) live -= 1
            sites.delete(target)
            released = true
            return target.delete()
          }
        return typeof property === "function"
          ? (...values: unknown[]) => track(Reflect.apply(property, target, values.map(unwrap)))
          : property
      },
    })
    targets.set(proxy, value)
    return proxy
  }
  const namespace = (value: object): object =>
    new Proxy(value, {
      get(target, key) {
        const property = Reflect.get(target, key, target)
        if (typeof property !== "function") return property
        return new Proxy(property, {
          construct: (nativeClass, values) =>
            track(Reflect.construct(nativeClass as Constructible, values.map(unwrap))) as object,
          apply: (callable, _self, values) =>
            track(Reflect.apply(callable as Callable, undefined, values.map(unwrap))),
          get: (nativeClass, member) => {
            const staticMember = Reflect.get(nativeClass, member, nativeClass)
            return typeof staticMember === "function"
              ? (...values: unknown[]) =>
                  track(Reflect.apply(staticMember, nativeClass, values.map(unwrap)))
              : staticMember
          },
        })
      },
    })
  return {
    kernel: namespace(kernel) as OpenCascadeInstance,
    live: () => live,
    /** Creation sites of wrappers not yet released, for leak diagnostics. */
    leaks: () => [...sites.values()],
  }
}
