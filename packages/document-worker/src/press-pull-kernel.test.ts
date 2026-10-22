import { afterAll, beforeAll, expect, it } from "bun:test"
import { resolveSelectedEdgeCandidates } from "@vibeshape/application/selected-edge-resolution"
import { resolveShellOpeningCandidates } from "@vibeshape/application/shell-opening-resolution"
import {
  type FeatureEvaluationInput,
  ReplicadGeometryEngine,
} from "@vibeshape/geometry-worker/engine"
import { vi } from "../../../tests/unit/support/bun-test"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
let ambiguousCatalogue = false
const engine = new ReplicadGeometryEngine(
  resolveSelectedEdgeCandidates,
  (references, candidates, scope) =>
    resolveShellOpeningCandidates(
      references,
      ambiguousCatalogue
        ? candidates.flatMap((candidate) =>
            candidate.kind === "face"
              ? [candidate, { ...candidate, candidateId: `${candidate.candidateId}:duplicate` }]
              : [candidate],
          )
        : candidates,
      scope,
    ),
)
const documentId = "press-pull-kernel"
let serial = 10
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  const wasm = readFileSync(
    new URL(
      "../../geometry-worker/node_modules/replicad-opencascadejs/src/replicad_single.wasm",
      import.meta.url,
    ),
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
afterAll(() => {
  engine.disposeDocument(documentId)
  expect(engine.getHealth().ownedShapeCount).toBe(0)
})

function request(
  type: string,
  version: number,
  parameters: unknown,
  source?: FeatureEvaluationInput,
  outputRole = "result",
): FeatureEvaluationInput {
  const current = serial++
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Native kernel must initialize before evaluation.")
  const dependencies = source
    ? [{ featureId: source.featureId, contentHash: source.contentHash, outputRole }]
    : []
  const feature = {
    schemaVersion: 0 as const,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId: `org.vibeshape.feature.part-design.${type}`,
      schemaVersion: version,
    },
    parameters: parameters as FeatureEvaluationInput["content"]["feature"]["parameters"],
    inputs: dependencies.map(({ contentHash }) => contentHash),
    references: [],
  }
  return {
    documentId,
    featureId: id(current),
    contentHash: current.toString(16).padStart(64, "0"),
    content: source
      ? { schemaVersion: 1, feature: { ...feature, inputRoles: [outputRole] }, environment }
      : { schemaVersion: 0, feature, environment },
    dependencies,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
async function evaluate(input: FeatureEvaluationInput) {
  const result = await engine.evaluateFeature(input, vi.fn())
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.result
}
async function box() {
  const input = request("box", 1, {
    width: 20,
    depth: 12,
    height: 10,
    centered: false,
    origin: [0, 0, 0],
  })
  return { input, result: await evaluate(input) }
}

function parameters(source: Awaited<ReturnType<typeof box>>, distance = 2, outputRole = "result") {
  const candidates =
    source.result.bodies?.find((body) => body.outputRole === outputRole)?.topologyCandidates ?? []
  const faces = candidates.filter(
    ({ kind, signature }) => kind === "face" && Math.abs(signature.centroid[2] - 10) < 1e-7,
  )
  const face = faces[0]
  if (faces.length !== 1 || !face) throw new Error("Fixture requires a unique body top face.")
  return {
    distance,
    sourceContentHash: source.input.contentHash,
    face: {
      schemaVersion: 1,
      kind: "face",
      outputRole,
      signature: face.signature,
      ...(face.semanticRole ? { semanticRole: face.semanticRole } : {}),
    },
  }
}
it("evaluates registered exact planar Press Pull and retains stable named body topology", async () => {
  const source = await box()
  const before = JSON.stringify(source.result)
  for (const distance of [2, -2]) {
    const result = await evaluate(
      request("press-pull", 1, parameters(source, distance), source.input),
    )
    expect(result.shape.valid).toBe(true)
    expect(result.shape.solidCount).toBe(1)
    expect(result.shape.volume).toBeCloseTo(240 * (10 + distance), 6)
    expect(result.bodies?.[0]?.outputRole).toBe("result")
    expect(result.bodies?.[0]?.topologyCandidates.some(({ kind }) => kind === "face")).toBe(true)
  }
  expect(JSON.stringify(source.result)).toBe(before)
})
it("modifies only the named constituent body of a multi-solid producer", async () => {
  const base = await box(),
    input = request("pattern", 1, { kind: "linear", axis: "X", count: 2, spacing: 30 }, base.input)
  const source = { input, result: await evaluate(input) }
  expect(source.result.shape.solidCount).toBe(2)
  const before = JSON.stringify(source.result)
  const role = "pattern.instance.1"
  const result = await evaluate(request("press-pull", 1, parameters(source, 2, role), input, role))
  expect(result.shape.solidCount).toBe(1)
  expect(result.shape.volume).toBeCloseTo(2880, 6)
  expect(result.shape.bounds.min[0]).toBeGreaterThan(19)
  expect(JSON.stringify(source.result)).toBe(before)
})
it("refuses stale source hashes, role mismatches, missing and ambiguous topology", async () => {
  const source = await box(),
    content = parameters(source)
  for (const changes of [
    { sourceContentHash: "f".repeat(64) },
    { face: { ...content.face, outputRole: "another-body" } },
    {
      face: {
        ...content.face,
        semanticRole: "missing",
        signature: { ...content.face.signature, measure: 999999, centroid: [500, 500, 500] },
      },
    },
    { distance: 0 },
    {
      face: {
        ...content.face,
        signature: { ...content.face.signature, geometryClass: "CYLINDRE" },
      },
    },
  ])
    expect(
      (
        await engine.evaluateFeature(
          request("press-pull", 1, { ...content, ...changes }, source.input),
          vi.fn(),
        )
      ).ok,
    ).toBe(false)
  ambiguousCatalogue = true
  try {
    expect(
      (await engine.evaluateFeature(request("press-pull", 1, content, source.input), vi.fn())).ok,
    ).toBe(false)
  } finally {
    ambiguousCatalogue = false
  }
})
it("releases preview results and borrowed targets through the normal document ownership boundary", async () => {
  const source = await box()
  const content = parameters(source)
  await evaluate(request("press-pull", 1, content, source.input))
  expect(engine.getHealth().ownedShapeCount).toBeGreaterThan(0)
  engine.disposeDocument(documentId)
  expect(engine.getHealth().ownedShapeCount).toBe(0)
  await evaluate(source.input)
  const rebuilt = await evaluate(request("press-pull", 1, content, source.input))
  expect(rebuilt.shape.volume).toBeCloseTo(2880, 6)
  engine.disposeDocument(documentId)
  expect(engine.getHealth().ownedShapeCount).toBe(0)
})
