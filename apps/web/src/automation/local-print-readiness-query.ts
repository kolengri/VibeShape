import {
  type LocalOperation,
  localFailure,
  printReadinessViewSchema,
} from "@vibeshape/automation-api/local-tools"
import {
  analyzePrintReadiness,
  MAX_READINESS_TRIANGLES,
  preparePrintMeshes,
} from "@vibeshape/print-analysis"
import { documentWorkerResponseSchema, printPreparationSettingsSchema } from "@vibeshape/protocol"
import { type ModelBodyView, terminalModelBodies } from "../features/part-design/model-bodies"
import type { MeasurementPreparationPort } from "./local-measurement-query"

type Operation = Extract<LocalOperation, { tool: "analyze_print_readiness" }>
type Request = Operation["arguments"]
type Context = NonNullable<ReturnType<MeasurementPreparationPort["readCommittedContext"]>>
function matchingContext(
  context: Context | null,
  documentId: string,
  revision: number,
): context is Context {
  return (
    context !== null &&
    context.snapshot.id === documentId &&
    context.snapshot.revision === revision &&
    context.rebuild.ok
  )
}
function currentRebuild(context: Context, documentId: string, revision: number) {
  const response = documentWorkerResponseSchema.safeParse(
    context.rebuild.ok ? context.rebuild.response : null,
  )
  if (
    !response.success ||
    response.data.type !== "documentRebuilt" ||
    response.data.documentId !== documentId ||
    response.data.revision !== revision
  )
    return null
  return response.data
}
function readBodies(context: Context, documentId: string, revision: number) {
  const response = currentRebuild(context, documentId, revision)
  if (!response)
    return localFailure(
      "geometry-unavailable",
      "The complete current model mesh is unavailable.",
      true,
    )
  if (response.evaluation.records.some(({ status }) => status === "failed" || status === "blocked"))
    return localFailure(
      "geometry-unavailable",
      "Repair failed or blocked model features before analyzing print readiness.",
      true,
    )
  const bodies = terminalModelBodies(context.snapshot.features, response)
  if (!bodies?.length || bodies.some(({ geometry }) => !geometry.shape.valid))
    return localFailure(
      "geometry-unavailable",
      "There are no complete current design bodies to analyze.",
    )
  return { ok: true as const, bodies }
}
function meshBudgetExceeded(bodies: readonly ModelBodyView[]) {
  return bodies.some(
    ({ geometry }) =>
      geometry.mesh.indices.length / 3 > MAX_READINESS_TRIANGLES ||
      geometry.mesh.positions.length > MAX_READINESS_TRIANGLES * 9,
  )
}
function unknownBody({ geometry, feature }: ModelBodyView) {
  return {
    name: (feature.label ?? "Body").slice(0, 512),
    triangleCount: geometry.mesh.indices.length / 3,
    topology: "complexity-limit",
    thinTriangles: 0,
    overhangTriangles: 0,
    unknownTriangles: geometry.mesh.indices.length / 3,
    minimumThicknessMm: null,
    thinAreaMm2: 0,
    overhangAreaMm2: 0,
  }
}
async function analyzeBodies(
  bodies: readonly ModelBodyView[],
  documentId: string,
  request: Request,
  signal?: AbortSignal,
) {
  if (meshBudgetExceeded(bodies))
    return printReadinessViewSchema.parse({
      documentId,
      ...request,
      status: "unknown",
      bodies: bodies.map(unknownBody),
    })
  const settings = printPreparationSettingsSchema.parse({
    rotationX: request.rotationX,
    rotationY: request.rotationY,
    rotationZ: request.rotationZ,
    supports: false,
  })
  const prepared = preparePrintMeshes({
    settings,
    meshes: bodies.map(({ geometry, feature }, i) => ({
      name: (feature.label || `Body ${i + 1}`).slice(0, 512),
      vertices: Array.from(geometry.mesh.positions),
      triangles: Array.from(geometry.mesh.indices),
    })),
  })
  const analysis = await analyzePrintReadiness(prepared.meshes, request, {
    signal,
    yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
  })
  return printReadinessViewSchema.parse({
    documentId,
    ...request,
    status: analysis.status,
    bodies: analysis.bodies.map((body) => ({
      ...body,
      thinTriangles: body.thinTriangles.length,
      overhangTriangles: body.overhangTriangles.length,
    })),
  })
}
const cancelled = () => localFailure("request-cancelled", "Print readiness was canceled.", true)
export async function executePrintReadinessQuery(
  port: MeasurementPreparationPort,
  documentId: string,
  operation: Operation,
  signal?: AbortSignal,
) {
  const request = operation.arguments
  const context = port.readCommittedContext()
  if (!matchingContext(context, documentId, request.revision))
    return localFailure(
      "stale-geometry",
      "Print readiness requires the current committed geometry revision.",
      true,
    )
  const source = readBodies(context, documentId, request.revision)
  if (!source.ok) return source
  if (signal?.aborted) return cancelled()
  try {
    const value = await analyzeBodies(source.bodies, documentId, request, signal)
    const current = port.readCommittedContext()
    if (signal?.aborted) return cancelled()
    if (
      !matchingContext(current, documentId, request.revision) ||
      current.rebuild !== context.rebuild
    )
      return localFailure("stale-geometry", "The print source changed during analysis.", true)
    return { ok: true as const, value }
  } catch (error) {
    if (signal?.aborted) return cancelled()
    return localFailure(
      "geometry-unavailable",
      error instanceof Error ? error.message : "The print mesh could not be analyzed.",
      true,
    )
  }
}
