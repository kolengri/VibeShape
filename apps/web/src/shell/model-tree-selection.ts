import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import type { FeatureId, PartId, SketchId } from "@vibeshape/domain/identifiers"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import { authoredBodyKey } from "./authored-tree-state"

export type ModelTreeSelection =
  | Readonly<{ kind: "part"; id: PartId }>
  | Readonly<{ kind: "sketch"; id: SketchId }>
  | Readonly<{ kind: "feature"; id: FeatureId }>
  | (ModelBodySelection & Readonly<{ kind: "body" }>)

export function modelTreeSelectionKey(item: ModelTreeSelection): string {
  return item.kind === "body" ? `body:${authoredBodyKey(item)}` : `${item.kind}:${item.id}`
}

export function extendModelTreeSelection(
  selected: readonly ModelTreeSelection[],
  ordered: readonly ModelTreeSelection[],
  target: ModelTreeSelection,
  anchor: string | null,
  modifiers: Readonly<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }>,
): readonly ModelTreeSelection[] {
  const key = modelTreeSelectionKey(target)
  const additive = modifiers.ctrlKey || modifiers.metaKey
  if (modifiers.shiftKey && anchor) {
    const start = ordered.findIndex((item) => modelTreeSelectionKey(item) === anchor)
    const end = ordered.findIndex((item) => modelTreeSelectionKey(item) === key)
    if (start >= 0 && end >= 0) {
      const range = ordered.slice(Math.min(start, end), Math.max(start, end) + 1)
      return additive
        ? [
            ...new Map(
              [...selected, ...range].map((item) => [modelTreeSelectionKey(item), item]),
            ).values(),
          ]
        : range
    }
  }
  if (!additive) return [target]
  return selected.some((item) => modelTreeSelectionKey(item) === key)
    ? selected.filter((item) => modelTreeSelectionKey(item) !== key)
    : [...selected, target]
}

const partsByBody = new WeakMap<
  readonly ResolvedAuthoredPart[],
  ReadonlyMap<string, ResolvedAuthoredPart | null>
>()

function currentBodyOwners(parts: readonly ResolvedAuthoredPart[]) {
  const cached = partsByBody.get(parts)
  if (cached) return cached
  const owners = new Map<string, ResolvedAuthoredPart | null>()
  for (const part of parts) {
    if (!part.body) continue
    const key = authoredBodyKey(part.body)
    owners.set(key, owners.has(key) ? null : part)
  }
  partsByBody.set(parts, owners)
  return owners
}

/** A face belongs to a part only when its exact current body binding is unique. */
export function partForModelBody(
  parts: readonly ResolvedAuthoredPart[],
  body: ModelBodySelection,
): ResolvedAuthoredPart | undefined {
  return currentBodyOwners(parts).get(authoredBodyKey(body)) ?? undefined
}
