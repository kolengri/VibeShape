type Deletable = { delete(): void }
export type OwnNative = <T extends Deletable>(resource: T) => T

function release(resources: readonly Deletable[]): unknown[] {
  const failures: unknown[] = []
  for (const resource of [...new Set(resources)].reverse()) {
    try {
      resource.delete()
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}

/**
 * Releases every owned temporary wrapper in reverse acquisition order. The result transfers to
 * the caller only after all other temporaries were released successfully.
 */
export function nativeResult<T extends Deletable>(label: string, build: (own: OwnNative) => T): T {
  const owned: Deletable[] = []
  const own: OwnNative = (resource) => {
    owned.push(resource)
    return resource
  }
  let result: T
  try {
    result = build(own)
  } catch (error) {
    const failures = release(owned)
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        `${label} failed while releasing native resources.`,
      )
    throw error
  }
  const failures = release(owned.filter((resource) => resource !== result))
  if (failures.length) {
    const resultFailures = release([result])
    throw new AggregateError(
      [...failures, ...resultFailures],
      `${label} could not release every temporary native resource.`,
    )
  }
  return result
}

/** Runs a native computation and releases every owned wrapper on success and failure. */
export function nativeScope<T>(label: string, compute: (own: OwnNative) => T): T {
  const owned: Deletable[] = []
  const own: OwnNative = (resource) => {
    owned.push(resource)
    return resource
  }
  let value: T
  try {
    value = compute(own)
  } catch (error) {
    const failures = release(owned)
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        `${label} failed while releasing native resources.`,
      )
    throw error
  }
  const failures = release(owned)
  if (failures.length)
    throw new AggregateError(failures, `${label} could not release every native resource.`)
  return value
}
