import { isPlainObject } from "is-what"

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }

  if (!isPlainObject(value)) {
    if (value !== null && typeof value === "object") {
      throw new TypeError("Canonical JSON accepts only JSON values.")
    }

    const serialized = JSON.stringify(value)

    if (serialized === undefined) {
      throw new TypeError("Canonical JSON accepts only JSON values.")
    }

    return serialized
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`
}
