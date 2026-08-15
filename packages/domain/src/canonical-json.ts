import { isArray, isNaNValue, isNumber, isPlainObject } from "is-what"

export function canonicalJson(value: unknown): string {
  if (isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }

  if (!isPlainObject(value)) {
    if (
      (value !== null && typeof value === "object") ||
      isNaNValue(value) ||
      (isNumber(value) && !Number.isFinite(value))
    ) {
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
