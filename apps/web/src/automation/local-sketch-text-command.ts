import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import type { LocalSketchTextOperation } from "@vibeshape/automation-api/local-sketch-text-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import type { AutomationHost } from "@vibeshape/automation-host/host"
import type { CommandActor } from "@vibeshape/domain/commands"
import { generateUuidV7, sketchEntityIdSchema } from "@vibeshape/domain/identifiers"
import type { SketchRecord } from "@vibeshape/domain/sketch"
import {
  BUNDLED_SKETCH_TEXT_FONT,
  SKETCH_TEXT_LAYOUT_ENGINE,
  SKETCH_TEXT_OUTLINE_SDK,
  sketchTextParametersSchema,
} from "@vibeshape/domain/sketch-text"
import { applySketchTextOutline, detachSketchTextGroup } from "@vibeshape/domain/sketch-text-edit"
import { hashSketchTextContent, loadSketchTextFont } from "../features/sketch/text/text-font"

function createEntityId() {
  return sketchEntityIdSchema.parse(
    generateUuidV7({
      timestampMs: Date.now(),
      randomBytes: crypto.getRandomValues(new Uint8Array(10)),
    }),
  )
}
function groupMatches(sketch: SketchRecord, operation: LocalSketchTextOperation) {
  const exists = sketch.textGroups?.some(({ id }) => id === operation.arguments.groupId) ?? false
  return operation.tool === "create_sketch_text" ? !exists : exists
}
async function prepareSketch(sketch: SketchRecord, operation: LocalSketchTextOperation) {
  if (operation.tool === "detach_sketch_text")
    return { ok: true as const, sketch: detachSketchTextGroup(sketch, operation.arguments.groupId) }
  const { prepareSketchTextOutline } = await import("@vibeshape/formats/text-outline")
  const parameters = sketchTextParametersSchema.parse({
    ...operation.arguments.intent,
    schemaVersion: 0,
    font: BUNDLED_SKETCH_TEXT_FONT,
    layoutEngine: SKETCH_TEXT_LAYOUT_ENGINE,
    outlineSdk: SKETCH_TEXT_OUTLINE_SDK,
  })
  const outline = await prepareSketchTextOutline(parameters, await loadSketchTextFont())
  if (!outline.ok)
    return localFailure(
      "invalid-text-outline",
      outline.diagnostics[0]?.message ?? "The text outline cannot be generated.",
    )
  return {
    ok: true as const,
    sketch: await applySketchTextOutline(sketch, {
      groupId: operation.arguments.groupId,
      parameters: outline.outline.parameters,
      origin: operation.arguments.origin,
      contours: outline.outline.contours,
      createEntityId,
      hash: hashSketchTextContent,
      replace: operation.tool === "update_sketch_text",
      removeAttachedConstraints:
        operation.tool === "update_sketch_text" && operation.arguments.removeAttachedConstraints,
    }),
  }
}
function cancelled(signal?: AbortSignal) {
  return signal?.aborted
    ? localFailure("request-cancelled", "Text preparation was cancelled.", true)
    : null
}
export async function executeSketchTextCommand(
  host: AutomationHost,
  actor: CommandActor,
  documentId: string,
  operation: LocalSketchTextOperation,
  signal?: AbortSignal,
) {
  if (!host.readOwnedSketch)
    return localFailure("text-unavailable", "The paired host cannot prepare editable sketch text.")
  const input = operation.arguments
  const read = await host.readOwnedSketch(actor, {
    schemaVersion: 1,
    draftId: input.draftId,
    revision: input.baseRevision,
    sketchId: input.sketchId,
  })
  if (!read.ok)
    return localFailure(read.diagnostic.code, read.diagnostic.message, read.diagnostic.retryable)
  if (!groupMatches(read.value, operation))
    return localFailure(
      "text-group-mismatch",
      "The text group identity does not match this operation.",
    )
  const before = cancelled(signal)
  if (before) return before
  try {
    const prepared = await prepareSketch(read.value, operation)
    if (!prepared.ok) return prepared
    const after = cancelled(signal)
    if (after) return after
    const current = await host.readOwnedSketch(actor, {
      schemaVersion: 1,
      draftId: input.draftId,
      revision: input.baseRevision,
      sketchId: input.sketchId,
    })
    if (!current.ok)
      return localFailure(
        current.diagnostic.code,
        current.diagnostic.message,
        current.diagnostic.retryable,
      )
    const beforeApply = cancelled(signal)
    if (beforeApply) return beforeApply
    const result = await host.applyCommand(
      actor,
      applyAutomationDraftCommandRequestSchema.parse({
        schemaVersion: 1,
        draftId: input.draftId,
        command: {
          schemaVersion: 1,
          kind: "org.vibeshape.sketch.update",
          commandId: input.commandId,
          documentId,
          baseRevision: input.baseRevision,
          issuedAt: new Date().toISOString(),
          actor,
          payload: { sketch: prepared.sketch },
        },
      }),
    )
    return result.ok
      ? { ok: true as const, value: result.value }
      : localFailure(result.diagnostic.code, result.diagnostic.message, result.diagnostic.retryable)
  } catch {
    const interrupted = cancelled(signal)
    if (interrupted) return interrupted
    return localFailure(
      "invalid-text-outline",
      "Text regeneration failed; keep existing geometry or detach its intent and constraints explicitly.",
    )
  }
}
