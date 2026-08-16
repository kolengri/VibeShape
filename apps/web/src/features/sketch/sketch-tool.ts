import type { SketchId } from "@vibeshape/domain"

export type ActiveSketchTool =
  | Readonly<{ kind: "select-sketch-plane" }>
  | Readonly<{ kind: "create-sketch" }>
  | Readonly<{ kind: "edit-sketch"; sketchId: SketchId }>

export type ActiveSketchEditorTool = Exclude<ActiveSketchTool, { kind: "select-sketch-plane" }>

export function isActiveSketchEditorTool(
  tool: ActiveSketchTool | null,
): tool is ActiveSketchEditorTool {
  return tool?.kind === "create-sketch" || tool?.kind === "edit-sketch"
}

export type SketchEditorTool =
  | "select"
  | "point"
  | "line"
  | "midpoint-line"
  | "rectangle"
  | "center-rectangle"
  | "aligned-rectangle"
  | "centered-aligned-rectangle"
  | "circle"
  | "three-point-circle"
  | "inscribed-polygon"
  | "circumscribed-polygon"
  | "slot"
  | "centered-slot"
  | "slot-from-selection"
  | "arc"
  | "three-point-arc"
  | "tangent-arc"
  | "trim"
  | "extend"
  | "split"
export type SketchModificationTool = Extract<SketchEditorTool, "extend" | "split" | "trim">
export type SketchDraftChangeMode = "record" | "replace"

const sketchModificationTools: ReadonlySet<SketchEditorTool> = new Set(["extend", "split", "trim"])

export function isSketchModificationTool(tool: SketchEditorTool): tool is SketchModificationTool {
  return sketchModificationTools.has(tool)
}
