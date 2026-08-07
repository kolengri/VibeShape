import type { AbstractIntlMessages } from "use-intl"

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never

export type MessageCatalog = AbstractIntlMessages

export type CatalogIssue =
  | { key: string; type: "extra-key" }
  | { key: string; type: "missing-key" }
  | {
      actual: readonly string[]
      expected: readonly string[]
      key: string
      type: "placeholder-mismatch"
    }

function flattenMessages(
  messages: AbstractIntlMessages,
  parentKey = "",
  flattened: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(messages)) {
    const messageKey = parentKey ? `${parentKey}.${key}` : key
    if (typeof value === "string") {
      flattened[messageKey] = value
    } else {
      flattenMessages(value, messageKey, flattened)
    }
  }

  return flattened
}

function placeholders(message: string): readonly string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_][\w.-]*)\s*(?=[,}])/g)]
    .map((match) => `{${match[1]}}`)
    .sort()
}

export function compareMessageCatalogs(
  reference: AbstractIntlMessages,
  candidate: AbstractIntlMessages,
): CatalogIssue[] {
  const referenceMessages = flattenMessages(reference)
  const candidateMessages = flattenMessages(candidate)
  const referenceKeys = Object.keys(referenceMessages).sort()
  const candidateKeys = Object.keys(candidateMessages).sort()
  const issues: CatalogIssue[] = []

  for (const key of referenceKeys) {
    const referenceMessage = referenceMessages[key]
    const candidateMessage = candidateMessages[key]
    if (candidateMessage === undefined) {
      issues.push({ key, type: "missing-key" })
      continue
    }
    if (referenceMessage === undefined) {
      continue
    }

    const expected = placeholders(referenceMessage)
    const actual = placeholders(candidateMessage)
    if (expected.join("\u0000") !== actual.join("\u0000")) {
      issues.push({ actual, expected, key, type: "placeholder-mismatch" })
    }
  }

  for (const key of candidateKeys) {
    if (referenceMessages[key] === undefined) {
      issues.push({ key, type: "extra-key" })
    }
  }

  return issues
}

export function mergeMessages<const Catalogs extends readonly AbstractIntlMessages[]>(
  ...catalogs: Catalogs
): UnionToIntersection<Catalogs[number]> {
  const merged: AbstractIntlMessages = {}

  for (const catalog of catalogs) {
    for (const [namespace, messages] of Object.entries(catalog)) {
      if (Object.hasOwn(merged, namespace)) {
        throw new Error(`Duplicate top-level message namespace: ${namespace}`)
      }
      merged[namespace] = messages
    }
  }

  return merged as UnionToIntersection<Catalogs[number]>
}
