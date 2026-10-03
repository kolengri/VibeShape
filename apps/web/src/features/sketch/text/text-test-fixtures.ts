import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cwd } from "node:process"
import { type SketchRecord, sketchEntityIdSchema, sketchRecordSchema } from "@vibeshape/domain"
import type { SketchTextGroup } from "@vibeshape/domain/sketch-text-groups"
import { createSketchTextDraft, parseSketchTextValues, sketchTextValues } from "./text-model"

export const fontBytes = Uint8Array.from(
  readFileSync(resolve(cwd(), "packages/formats/src/text-outline/fonts/NotoSans-Regular.ttf")),
)
export const textId = (n: number) =>
  sketchEntityIdSchema.parse(`0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`)
export function emptyTextSketch() {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: textId(1),
    label: "Lettering",
    plane: "xy",
    entities: [],
    constraints: [],
  })
}
export function requireTextGroup(sketch: SketchRecord): SketchTextGroup {
  const group = sketch.textGroups?.[0]
  if (!group) throw new Error("The text fixture requires an authored group.")
  return group
}
export async function authoredTextSketch(text = "O") {
  const parsed = parseSketchTextValues({ ...sketchTextValues(), text })
  if (!parsed.ok) throw new Error("The text fixture parameters must be valid.")
  let next = 10
  return createSketchTextDraft(emptyTextSketch(), {
    parameters: parsed.parameters,
    origin: [12, -8],
    fontBytes,
    removeAttachedConstraints: false,
    createEntityId: () => textId(next++),
  })
}
