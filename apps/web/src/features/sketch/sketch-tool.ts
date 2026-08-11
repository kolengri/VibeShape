import type { SketchId } from "@vibeshape/domain"

export type ActiveSketchTool =
  | Readonly<{ kind: "create-sketch" }>
  | Readonly<{ kind: "edit-sketch"; sketchId: SketchId }>

export type SketchEditorTool = "select" | "point" | "line" | "rectangle" | "circle" | "arc"
export type SketchDraftChangeMode = "record" | "replace"
