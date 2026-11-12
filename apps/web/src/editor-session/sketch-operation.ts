import type { EditorSessionState } from "./editor-session-store"

/**
 * A sketch is being created or edited: a sketch tool is active or an unsaved draft exists.
 * Finish sketch keeps the sketch selected for profile picking without an operation.
 */
export function sketchOperationActive(
  sketch: Pick<EditorSessionState["sketch"], "activeSketchTool" | "draft">,
) {
  return sketch.activeSketchTool !== null || sketch.draft !== null
}
