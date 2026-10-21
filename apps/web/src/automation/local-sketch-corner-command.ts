import type { AutomationDraftInspectionView } from "@vibeshape/automation-api/draft-inspection"
import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import {
  type SketchSolutionQuery,
  type SketchSolutionView,
  sketchSolutionPageMatches,
} from "@vibeshape/automation-api/queries"
import type { LocalSketchCornerOperation } from "@vibeshape/automation-api/sketch-corner-tools"
import type { AutomationHost } from "@vibeshape/automation-host/host"
import type { CommandActor } from "@vibeshape/domain/commands"
import {
  documentIdSchema,
  generateUuidV7,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
} from "@vibeshape/domain/identifiers"
import type { SketchRecord } from "@vibeshape/domain/sketch"
import {
  type SketchCornerTreatment,
  sketchCornerTreatmentSchema,
  treatSketchCorner,
} from "@vibeshape/domain/sketch-corner-edit"
import type { SketchPoint2 } from "@vibeshape/domain/sketch-edit"
import { type LengthQuantity, lengthQuantitySchema } from "@vibeshape/domain/units"
import { type ExpressionValue, resolveQuantityExpression } from "@vibeshape/domain/variables"

type Arguments = LocalSketchCornerOperation["arguments"]

function createId() {
  return generateUuidV7({
    timestampMs: Date.now(),
    randomBytes: crypto.getRandomValues(new Uint8Array(10)),
  })
}
function cancelled(signal?: AbortSignal) {
  return signal?.aborted
    ? localFailure("request-cancelled", "Sketch corner preparation was cancelled.", true)
    : null
}
function inspectionMatches(
  value: AutomationDraftInspectionView,
  input: Arguments,
  documentId: string,
) {
  return (
    value.draft.draftId === input.draftId &&
    value.draft.documentId === documentId &&
    value.draft.revision === input.baseRevision &&
    value.view.documentId === documentId &&
    value.view.revision === input.baseRevision
  )
}

function solvedPointPage(
  inspection: AutomationDraftInspectionView,
  input: Arguments,
  query: SketchSolutionQuery,
  pointCount: number,
) {
  const view = inspection.view
  if (
    !inspectionMatches(inspection, input, query.documentId) ||
    view.kind !== "org.vibeshape.sketch.solution" ||
    view.data.section !== "points" ||
    !sketchSolutionPageMatches(view, query) ||
    view.counts.points !== pointCount ||
    view.counts.failedConstraints !== 0 ||
    (view.summary.status !== "fully-constrained" && view.summary.status !== "under-constrained")
  )
    return null
  return { items: view.data.items, nextCursor: view.nextCursor }
}

function appendSolvedPoints(
  points: Map<string, SketchPoint2>,
  pointIds: ReadonlySet<string>,
  items: Extract<SketchSolutionView["data"], { section: "points" }>["items"],
) {
  for (const point of items) {
    if (!pointIds.has(point.entityId) || points.has(point.entityId)) return false
    points.set(point.entityId, { x: point.x, y: point.y })
  }
  return true
}

async function readSolvedPoints(
  host: AutomationHost,
  actor: CommandActor,
  documentId: string,
  input: Arguments,
  sketch: SketchRecord,
  signal?: AbortSignal,
) {
  const pointIds = new Set(
    sketch.entities.flatMap((entity) => (entity.type === "point" ? [entity.id] : [])),
  )
  const points = new Map<string, SketchPoint2>()
  let cursor: SketchSolutionQuery["cursor"] = null
  do {
    const before = cancelled(signal)
    if (before) return before
    const query: SketchSolutionQuery = {
      kind: "org.vibeshape.sketch.solution",
      schemaVersion: 1,
      documentId: documentIdSchema.parse(documentId),
      revision: input.baseRevision,
      sketchId: input.sketchId,
      section: "points",
      cursor,
      limit: 200,
    }
    const result = await host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId: input.draftId,
      query,
    })
    const after = cancelled(signal)
    if (after) return after
    if (!result.ok)
      return localFailure(
        result.diagnostic.code,
        result.diagnostic.message,
        result.diagnostic.retryable,
      )
    const page = solvedPointPage(result.value, input, query, pointIds.size)
    if (!page)
      return localFailure(
        "invalid-sketch-solution",
        "Corner treatment requires the exact valid draft sketch solution.",
      )
    if (!appendSolvedPoints(points, pointIds, page.items))
      return localFailure("invalid-sketch-solution", "Solved points do not match the draft sketch.")
    cursor = page.nextCursor
  } while (cursor !== null)
  return { ok: true as const, value: points }
}

function variablePageProgressMatches(
  cursor: string | null,
  count: number,
  nextCursor: string | null,
) {
  const next = Number(cursor ?? 0) + count
  return !(next > 4096 || (nextCursor !== null && (count === 0 || Number(nextCursor) !== next)))
}

function appendDraftVariables(
  values: Map<string, ExpressionValue>,
  variables: Extract<
    AutomationDraftInspectionView["view"],
    { kind: "org.vibeshape.variable.list" }
  >["data"]["variables"],
) {
  for (const entry of variables) {
    if (values.has(entry.definition.name)) return false
    values.set(entry.definition.name, entry.result)
  }
  return true
}

async function readVariables(
  host: AutomationHost,
  actor: CommandActor,
  documentId: string,
  input: Arguments,
  signal?: AbortSignal,
) {
  const values = new Map<string, ExpressionValue>()
  let cursor: string | null = null
  do {
    const before = cancelled(signal)
    if (before) return before
    const result = await host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId: input.draftId,
      query: {
        kind: "org.vibeshape.variable.list",
        schemaVersion: 1,
        documentId,
        revision: input.baseRevision,
        cursor,
        limit: 200,
      },
    })
    const after = cancelled(signal)
    if (after) return after
    if (!result.ok)
      return localFailure(
        result.diagnostic.code,
        result.diagnostic.message,
        result.diagnostic.retryable,
      )
    const view = result.value.view
    if (
      !inspectionMatches(result.value, input, documentId) ||
      view.kind !== "org.vibeshape.variable.list"
    )
      return localFailure(
        "invalid-draft-variables",
        "Variables must describe the exact draft revision.",
      )
    if (!variablePageProgressMatches(cursor, view.data.variables.length, view.nextCursor))
      return localFailure("invalid-draft-variables", "The draft variable page is incomplete.")
    if (!appendDraftVariables(values, view.data.variables))
      return localFailure("invalid-draft-variables", "The draft variable names must be unique.")
    cursor = view.nextCursor
  } while (cursor !== null)
  return { ok: true as const, value: values }
}

function treatmentQuantities(treatment: SketchCornerTreatment) {
  return treatment.kind === "fillet"
    ? [treatment.radius]
    : [treatment.firstDistance, treatment.secondDistance]
}
function resolveTreatment(
  treatment: SketchCornerTreatment,
  variables: ReadonlyMap<string, ExpressionValue>,
) {
  const resolve = (quantity: LengthQuantity) => {
    const result = resolveQuantityExpression(quantity, variables)
    if (!result.ok) throw new TypeError(result.diagnostic.message)
    return lengthQuantitySchema.parse(result.quantity)
  }
  return sketchCornerTreatmentSchema.parse(
    treatment.kind === "fillet"
      ? { ...treatment, radius: resolve(treatment.radius) }
      : {
          ...treatment,
          firstDistance: resolve(treatment.firstDistance),
          secondDistance: resolve(treatment.secondDistance),
        },
  )
}

async function prepareSketchCorner(
  host: AutomationHost,
  actor: CommandActor,
  documentId: string,
  input: Arguments,
  sketch: SketchRecord,
  signal?: AbortSignal,
) {
  const points = await readSolvedPoints(host, actor, documentId, input, sketch, signal)
  if (!points.ok) return points
  let treatment = input.treatment
  if (treatmentQuantities(treatment).some((quantity) => quantity.source.expression !== null)) {
    const variables = await readVariables(host, actor, documentId, input, signal)
    if (!variables.ok) return variables
    treatment = resolveTreatment(treatment, variables.value)
  }
  const prepared = treatSketchCorner(sketch, {
    treatment,
    solvedPoints: points.value,
    createEntityId: () => sketchEntityIdSchema.parse(createId()),
    createConstraintId: () => sketchConstraintIdSchema.parse(createId()),
  })
  return { ok: true as const, value: prepared.sketch }
}

function createSketchCornerCommand(
  actor: CommandActor,
  documentId: string,
  input: Arguments,
  sketch: SketchRecord,
) {
  return applyAutomationDraftCommandRequestSchema.parse({
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
      payload: { sketch },
    },
  })
}

export async function executeSketchCornerCommand(
  host: AutomationHost,
  actor: CommandActor,
  documentId: string,
  operation: LocalSketchCornerOperation,
  signal?: AbortSignal,
) {
  const before = cancelled(signal)
  if (before) return before
  if (!host.readOwnedSketch)
    return localFailure(
      "sketch-corner-unavailable",
      "The paired host cannot prepare sketch corners.",
    )
  const input = operation.arguments
  const request = {
    schemaVersion: 1,
    draftId: input.draftId,
    revision: input.baseRevision,
    sketchId: input.sketchId,
  }
  try {
    const read = await host.readOwnedSketch(actor, request)
    if (!read.ok)
      return localFailure(read.diagnostic.code, read.diagnostic.message, read.diagnostic.retryable)
    const prepared = await prepareSketchCorner(host, actor, documentId, input, read.value, signal)
    if (!prepared.ok) return prepared
    const current = await host.readOwnedSketch(actor, request)
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
      createSketchCornerCommand(actor, documentId, input, prepared.value),
    )
    return result.ok
      ? { ok: true as const, value: result.value }
      : localFailure(result.diagnostic.code, result.diagnostic.message, result.diagnostic.retryable)
  } catch {
    return (
      cancelled(signal) ??
      localFailure("invalid-sketch-corner", "Corner treatment could not be prepared or applied.")
    )
  }
}
