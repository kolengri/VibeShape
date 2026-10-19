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

/** A face belongs to a part only when its exact current body binding is unique. */
export function partForModelBody(
  parts: readonly ResolvedAuthoredPart[],
  body: ModelBodySelection,
): ResolvedAuthoredPart | undefined {
  const matches = parts.filter(
    (part) => part.body && authoredBodyKey(part.body) === authoredBodyKey(body),
  )
  return matches.length === 1 ? matches[0] : undefined
}
