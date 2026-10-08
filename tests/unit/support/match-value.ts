// Bun 1.4.2 replaces received values with nested asymmetric matchers in toMatchObject.
// Preserve the subject for later assertions and production calls in the same scenario.
export function matchValue<T>(value: T, seen = new WeakMap<object, object>()): T {
  if (value instanceof Promise) return value.then((result) => matchValue(result)) as T
  if (value === null || typeof value !== "object") return value
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return value
  const existing = seen.get(value)
  if (existing) return existing as T
  const clone = Array.isArray(value) ? [] : {}
  seen.set(value, clone)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    if ("value" in descriptor) descriptor.value = matchValue(descriptor.value, seen)
    Object.defineProperty(clone, key, descriptor)
  }
  return clone as T
}
