import type { SketchId } from "@vibeshape/domain"

export type ActiveSketchTool =
  | Readonly<{ kind: "create-rectangle-sketch" }>
  | Readonly<{ kind: "edit-rectangle-sketch"; sketchId: SketchId }>
