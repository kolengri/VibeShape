import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import { type DocumentId, type SketchId, sketchIdSchema } from "@vibeshape/domain/identifiers"
import { sketchProfileSelectorSchema } from "@vibeshape/domain/sketch-profile-selector"
import {
  type SketchSolutionEvidence,
  sketchSolutionEvidenceMatchesDocument,
  sketchSolutionEvidenceSchema,
} from "@vibeshape/domain/sketch-solution-evidence"
import {
  documentWorkerResponseSchema,
  type FeatureMeshPolicy,
  featureMeshPolicySchema,
  type SolvedSketchWire,
} from "@vibeshape/protocol"
import type { DocumentRebuildPort } from "./persistent-document-session"

export type SketchInspectionFailureCode =
  | "sketch-not-found"
  | "stale-geometry"
  | "invalid-geometry-evidence"
  | "preview-cancelled"
  | "preview-disposed"
  | "preview-failed"
export type SketchInspectionResult =
  | { ok: true; evidence: SketchSolutionEvidence }
  | { ok: false; code: SketchInspectionFailureCode }
type Pending = {
  port: DocumentRebuildPort
  settled: boolean
  resolve: (result: SketchInspectionResult) => void
}
export function createDisposableSketchInspection(
  options: Readonly<{
    createRebuildPort: (documentId: DocumentId) => DocumentRebuildPort
    mesh: FeatureMeshPolicy
    createInspectionId: () => string
  }>,
) {
  const mesh = featureMeshPolicySchema.parse(options.mesh)
  let pending: Pending | null = null
  let disposed = false
  function settle(operation: Pending, result: SketchInspectionResult) {
    if (operation.settled) return
    operation.settled = true
    if (pending === operation) pending = null
    try {
      operation.port.terminate()
    } catch {
      /* The isolated port is already discarded. */
    }
    operation.resolve(result)
  }
  function cancel() {
    if (pending) settle(pending, { ok: false, code: "preview-cancelled" })
  }
  async function run(operation: Pending, snapshot: DocumentSnapshot, sketchId: SketchId) {
    try {
      const rebuilt = validateRebuild(
        snapshot,
        await operation.port.rebuild({ document: snapshot, mesh }),
      )
      if (operation.settled) return
      if (!rebuilt.ok) {
        settle(operation, rebuilt)
        return
      }
      const solved = validateSolve(
        snapshot,
        sketchId,
        rebuilt.generation,
        await operation.port.solveSketch({ sketchId }),
      )
      if (operation.settled) return
      if (!solved.ok) {
        settle(operation, solved)
        return
      }
      const evidence = projectSketchSolution(
        snapshot,
        solved.solution,
        rebuilt.generation,
        options.createInspectionId(),
      )
      settle(
        operation,
        evidence ? { ok: true, evidence } : { ok: false, code: "invalid-geometry-evidence" },
      )
    } catch {
      if (!operation.settled) settle(operation, { ok: false, code: "preview-failed" })
    }
  }
  function inspect(
    input: DocumentSnapshot,
    sketchInput: SketchId,
  ): Promise<SketchInspectionResult> {
    if (disposed) return Promise.resolve({ ok: false, code: "preview-disposed" })
    cancel()
    const snapshot = documentSnapshotSchema.safeParse(input)
    const sketchId = sketchIdSchema.safeParse(sketchInput)
    if (!snapshot.success || !sketchId.success)
      return Promise.resolve({ ok: false, code: "invalid-geometry-evidence" })
    if (!snapshot.data.sketches.some(({ id }) => id === sketchId.data))
      return Promise.resolve({ ok: false, code: "sketch-not-found" })
    let port: DocumentRebuildPort
    try {
      port = options.createRebuildPort(snapshot.data.id)
    } catch {
      return Promise.resolve({ ok: false, code: "preview-failed" })
    }
    return new Promise((resolve) => {
      const operation: Pending = { port, resolve, settled: false }
      pending = operation
      void run(operation, snapshot.data, sketchId.data)
    })
  }
  return {
    inspect,
    cancel,
    dispose: () => {
      disposed = true
      cancel()
    },
  }
}

function projectProfiles(solution: SolvedSketchWire) {
  return solution.profileResult.profiles.map((profile) => {
    const outer = solution.profileResult.loops[profile.outerLoopIndex]
    if (!outer) throw new Error("The solved profile has no outer boundary.")
    const holes = profile.holeLoopIndices
      .map((index) => {
        const loop = solution.profileResult.loops[index]
        if (!loop) throw new Error("The solved profile has no hole boundary.")
        return [...loop.sourceEntityIds].sort()
      })
      .sort((a, b) => a.join(":").localeCompare(b.join(":")))
    return {
      selector: sketchProfileSelectorSchema.parse({
        schemaVersion: 0,
        sketchId: solution.sketchId,
        outerBoundaryEntityIds: [...outer.sourceEntityIds].sort(),
        holeBoundaryEntityIds: holes,
      }),
      area: profile.area,
      perimeter: profile.perimeter,
      bounds: profile.bounds,
    }
  })
}
function projectSketchSolution(
  snapshot: DocumentSnapshot,
  solution: SolvedSketchWire,
  generation: number,
  inspectionId: string,
) {
  const sketch = snapshot.sketches.find(({ id }) => id === solution.sketchId)
  if (!sketch) return null
  const authored = new Set<string>(sketch.entities.map(({ id }) => id))
  const parsed = sketchSolutionEvidenceSchema.safeParse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation,
    inspectionId,
    sketchId: solution.sketchId,
    summary: {
      status: solution.status,
      degreesOfFreedom: solution.degreesOfFreedom,
      maximumResidual: solution.maximumResidual,
      solver: solution.solverBuild.solver,
      moduleSha256: solution.solverBuild.moduleSha256,
      wasmSha256: solution.solverBuild.wasmSha256,
    },
    points: solution.points.filter(({ entityId }) => authored.has(entityId)),
    circles: solution.circles.filter(({ entityId }) => authored.has(entityId)),
    failedConstraintIds: solution.failedConstraintIds,
    profiles: projectProfiles(solution),
    diagnostics: solution.profileResult.diagnostics,
  })
  return parsed.success && sketchSolutionEvidenceMatchesDocument(snapshot, parsed.data)
    ? parsed.data
    : null
}
function validateRebuild(snapshot: DocumentSnapshot, input: unknown) {
  const parsed = documentWorkerResponseSchema.safeParse(input)
  if (!parsed.success || parsed.data.type !== "documentRebuilt")
    return { ok: false as const, code: "invalid-geometry-evidence" as const }
  if (parsed.data.documentId !== snapshot.id || parsed.data.revision !== snapshot.revision)
    return { ok: false as const, code: "stale-geometry" as const }
  return { ok: true as const, generation: parsed.data.generation }
}
function validateSolve(
  snapshot: DocumentSnapshot,
  sketchId: SketchId,
  generation: number,
  input: unknown,
) {
  const parsed = documentWorkerResponseSchema.safeParse(input)
  if (!parsed.success || parsed.data.type !== "sketchSolved")
    return { ok: false as const, code: "invalid-geometry-evidence" as const }
  const solved = parsed.data
  if (
    solved.documentId !== snapshot.id ||
    solved.revision !== snapshot.revision ||
    solved.generation !== generation ||
    solved.solution.sourceRevision !== snapshot.revision ||
    solved.solution.sketchId !== sketchId
  )
    return { ok: false as const, code: "stale-geometry" as const }
  return { ok: true as const, solution: solved.solution }
}
