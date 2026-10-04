// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest"
import {
  type FeatureEvaluationInput,
  type GeometryShellOpeningResolver,
  ReplicadGeometryEngine,
} from "./engine"
import { loftPatchTestId as id, loftPatchContentFixture } from "./occt-loft-patch-test-fixtures"

let unavailable = false
const resolver: GeometryShellOpeningResolver = (references, candidates, scope) => {
  if (unavailable) return { ok: false, reason: "missing" }
  const matches = candidates.filter((candidate) =>
    references.some(
      (reference) =>
        reference.outputRole === scope.outputRole &&
        JSON.stringify(reference.signature) === JSON.stringify(candidate.signature),
    ),
  )
  return matches.length === references.length
    ? {
        ok: true,
        candidateIds: matches
          .filter((candidate) => candidate.kind === "face")
          .map((candidate) => candidate.candidateId),
      }
    : { ok: false, reason: "ambiguous" }
}
const engine = new ReplicadGeometryEngine(undefined, resolver)
const documentId = "constrained-loft-kernel"
beforeAll(async () => {
  const filesystem = await vi.importActual<{ readFileSync(path: URL): Uint8Array }>("node:fs")
  const wasm = filesystem.readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(wasm))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
}, 60000)
afterAll(() => engine.disposeDocument(documentId))
function request(
  version: number,
  featureId: string,
  hash: string,
  parameters: unknown,
  dependencies: FeatureEvaluationInput["dependencies"],
): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("An initialized native environment is required.")
  const fields = {
    schemaVersion: 0 as const,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId: "org.vibeshape.feature.part-design.loft",
      schemaVersion: version,
    },
    parameters: parameters as FeatureEvaluationInput["content"]["feature"]["parameters"],
    inputs: dependencies.map((d) => d.contentHash),
    references: [],
  }
  return {
    documentId,
    featureId,
    contentHash: hash,
    content: dependencies.length
      ? {
          schemaVersion: 1,
          feature: { ...fields, inputRoles: dependencies.map((d) => d.outputRole ?? null) },
          environment,
        }
      : { schemaVersion: 0, feature: fields, environment },
    dependencies,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
it("resolves exact named end faces, applies independent G1/G2 ends, caches, fails closed and releases native outputs", async () => {
  const fixture = loftPatchContentFixture()
  const sourceRequest = request(
    1,
    id(400),
    "a".repeat(64),
    { sections: fixture.sections, ruled: false },
    [],
  )
  const source = await engine.evaluateFeature(sourceRequest, vi.fn())
  if (!source.ok) throw new Error(source.diagnostic.message)
  const wall = source.result.topologyCandidates.find(
    (candidate) =>
      candidate.kind === "face" && Math.abs((candidate.signature.centroid[1] ?? 0) + 2) < 1e-6,
  )
  if (!wall) throw new Error("The exact support wall must be captured.")
  const support = {
    schemaVersion: 1 as const,
    kind: "face" as const,
    outputRole: "result",
    signature: wall.signature,
  }
  const parameters = {
    ...fixture,
    start: [{ segmentTrack: 0, continuity: "G1", supportInputIndex: 0, support }],
    end: [{ segmentTrack: 0, continuity: "G2", supportInputIndex: 0, support }],
  }
  const dependencies = [
    { featureId: id(400), contentHash: sourceRequest.contentHash, outputRole: "result" },
  ]
  const input = request(3, id(401), "b".repeat(64), parameters, dependencies)
  const built = await engine.evaluateFeature(input, vi.fn())
  if (!built.ok) throw new Error(built.diagnostic.message)
  expect(built.result.shape.valid).toBe(true)
  expect(built.result.shape.solidCount).toBe(1)
  expect(built.result.shape.volume).toBeGreaterThan(source.result.shape.volume + 1e-5)
  expect(built.result.bodies?.map((body) => body.outputRole)).toEqual(["result"])
  expect(await engine.evaluateFeature(input, vi.fn())).toMatchObject({
    ok: true,
    result: { cache: { brepHit: true } },
  })
  expect(engine.getHealth().ownedShapeCount).toBe(2)
  const retryInput = request(3, id(402), "c".repeat(64), parameters, dependencies)
  unavailable = true
  try {
    expect(await engine.evaluateFeature(retryInput, vi.fn())).toMatchObject({ ok: false })
  } finally {
    unavailable = false
  }
  expect(engine.getHealth().ownedShapeCount).toBe(2)
  expect(await engine.evaluateFeature(retryInput, vi.fn())).toMatchObject({ ok: true })
  expect(engine.getHealth().ownedShapeCount).toBe(3)
  engine.disposeDocument(documentId)
  expect(engine.getHealth().ownedShapeCount).toBe(0)
}, 60000)
