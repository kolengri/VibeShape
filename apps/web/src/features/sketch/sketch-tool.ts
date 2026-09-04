import type { SketchId } from "@vibeshape/domain"
import type { SketchConstraintToolKind } from "./sketch-constraint-tools"

export type ActiveSketchEditorTool =
  | Readonly<{ kind: "create-sketch" }>
  | Readonly<{ kind: "edit-sketch"; sketchId: SketchId }>

export type SketchSupportReplacementReturn = Readonly<{
  cameraMode: "normal" | "orbit"
  showFinalContext: boolean
  tool: ActiveSketchEditorTool
}>

export type ActiveSketchTool =
  | Readonly<{ kind: "select-sketch-plane"; returnTo?: SketchSupportReplacementReturn }>
  | ActiveSketchEditorTool

export function isActiveSketchEditorTool(
  tool: ActiveSketchTool | null,
): tool is ActiveSketchEditorTool {
  return tool?.kind === "create-sketch" || tool?.kind === "edit-sketch"
}

export type SketchConstraintEditorTool = `constraint-${SketchConstraintToolKind}`

export type SketchEditorTool =
  | "select"
  | "dimension"
  | "use"
  | "intersection"
  | "pierce"
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
  | SketchConstraintEditorTool
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
  return tool === "select" || tool === "dimension" || sketchConstraintToolKind(tool) !== null
}

export const sketchConstraintEditorTools = {
  coincident: "constraint-coincident",
  concentric: "constraint-concentric",
  equal: "constraint-equal",
  fixed: "constraint-fixed",
  horizontal: "constraint-horizontal",
  midpoint: "constraint-midpoint",
  parallel: "constraint-parallel",
  perpendicular: "constraint-perpendicular",
  "point-on-curve": "constraint-point-on-curve",
  "point-on-line": "constraint-point-on-line",
  symmetric: "constraint-symmetric",
  tangent: "constraint-tangent",
  vertical: "constraint-vertical",
} as const satisfies Readonly<Record<SketchConstraintToolKind, SketchEditorTool>>

export function sketchConstraintToolKind(tool: SketchEditorTool): SketchConstraintToolKind | null {
  switch (tool) {
    case "constraint-coincident":
      return "coincident"
    case "constraint-concentric":
      return "concentric"
    case "constraint-equal":
      return "equal"
    case "constraint-fixed":
      return "fixed"
    case "constraint-horizontal":
      return "horizontal"
    case "constraint-midpoint":
      return "midpoint"
    case "constraint-parallel":
      return "parallel"
    case "constraint-perpendicular":
      return "perpendicular"
    case "constraint-point-on-curve":
      return "point-on-curve"
    case "constraint-point-on-line":
      return "point-on-line"
    case "constraint-symmetric":
      return "symmetric"
    case "constraint-tangent":
      return "tangent"
    case "constraint-vertical":
      return "vertical"
    default:
      return null
  }
}

export function isSketchConstraintEditorTool(
  tool: SketchEditorTool,
): tool is SketchConstraintEditorTool {
  return sketchConstraintToolKind(tool) !== null
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
