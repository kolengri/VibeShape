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
  | "dimension"
  | "use"
  | "point"
  | "line"
  | "midpoint-line"
  | "rectangle"
  | "center-rectangle"
  | "aligned-rectangle"
  | "centered-aligned-rectangle"
  | "circle"
  | "ellipse"
  | "elliptical-arc"
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
  | "mirror"
  | "offset"
  | "linear-pattern"
  | "circular-pattern"
  | "split"
  | "transform"
export type SketchModificationTool = Extract<
  SketchEditorTool,
  | "circular-pattern"
  | "extend"
  | "linear-pattern"
  | "mirror"
  | "offset"
  | "split"
  | "transform"
  | "trim"
>
export type SketchDraftChangeMode = "record" | "replace"

export function isSketchSelectionTool(tool: SketchEditorTool) {
  return tool === "select" || tool === "dimension"
}

const sketchModificationTools: ReadonlySet<SketchEditorTool> = new Set([
  "circular-pattern",
  "extend",
  "linear-pattern",
  "mirror",
  "offset",
  "split",
  "transform",
  "trim",
])

export function isSketchModificationTool(tool: SketchEditorTool): tool is SketchModificationTool {
  return sketchModificationTools.has(tool)
}

export function usesSketchCrosshairCursor(tool: SketchEditorTool) {
  return tool === "dimension" || isSketchModificationTool(tool)
}
