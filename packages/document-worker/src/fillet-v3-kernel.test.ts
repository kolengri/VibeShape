import { afterAll, beforeAll, expect, it } from "bun:test"
import { resolveSelectedEdgeCandidates } from "@vibeshape/application/selected-edge-resolution"
import { resolveShellOpeningCandidates } from "@vibeshape/application/shell-opening-resolution"
import {
  type FeatureEvaluationInput,
  ReplicadGeometryEngine,
} from "@vibeshape/geometry-worker/engine"
import type { FilletFeatureContentParametersV3, TopologyCandidate } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
let duplicateEdges = false
let edgeResolverFailure: Error | null = null
const engine = new ReplicadGeometryEngine((references, candidates, sourceFeatureId) => {
  if (edgeResolverFailure) throw edgeResolverFailure
  return resolveSelectedEdgeCandidates(
    references,
    duplicateEdges
      ? candidates.flatMap((candidate) =>
          candidate.kind === "edge"
            ? [candidate, { ...candidate, candidateId: `${candidate.candidateId}:copy` }]
            : [candidate],
        )
      : candidates,
    sourceFeatureId,
  )
}, resolveShellOpeningCandidates)
const documentId = "fillet-v3-kernel"
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

type Source = { featureId: string; contentHash: string; outputRole?: string }
function featureInput(
  type: string,
  version: number,
  parameters: unknown,
  source?: Source,
): FeatureEvaluationInput {
  const current = serial++
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Native kernel must initialize before evaluation.")
  const dependencies = source
    ? [
        {
          featureId: source.featureId,
          contentHash: source.contentHash,
          outputRole: source.outputRole ?? "result",
        },
      ]
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
      ? {
          schemaVersion: 1,
          feature: { ...feature, inputRoles: [source.outputRole ?? "result"] },
          environment,
        }
      : { schemaVersion: 0, feature, environment },
    dependencies,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
async function evaluated(input: FeatureEvaluationInput) {
  const result = await engine.evaluateFeature(input, vi.fn())
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.result
}
async function sourceBox(origin: readonly [number, number, number] = [0, 0, 0]) {
  const input = featureInput("box", 1, {
    width: 20,
    depth: 12,
    height: 10,
    centered: false,
    origin,
  })
  return { input, result: await evaluated(input) }
}
function only(
  candidates: readonly TopologyCandidate[],
  kind: "edge" | "face",
  match: (signature: TopologyCandidate["signature"]) => boolean,
) {
  const selected = candidates.filter((value) => value.kind === kind && match(value.signature))
  if (selected.length !== 1 || !selected[0])
    throw new Error(`Fixture requires exactly one ${kind}: ${selected.length}`)
  return selected[0]
}
function reference<K extends "edge" | "face">(value: TopologyCandidate, kind: K, role = "result") {
  return {
    schemaVersion: 1 as const,
    kind,
    outputRole: role,
    signature: value.signature,
    ...(value.semanticRole ? { semanticRole: value.semanticRole } : {}),
  }
}
/** The centered box's top front edge runs along X at y = -6, z = 10. */
const topFront = (s: TopologyCandidate["signature"]) =>
  Math.abs(s.centroid[1] + 6) < 1e-7 && Math.abs(s.centroid[2] - 10) < 1e-7 && s.measure > 19
const nearPoint = (candidates: readonly TopologyCandidate[], point: readonly number[]) =>
  candidates.some(
    ({ kind, signature }) =>
      kind === "vertex" &&
      point.every((value, axis) => Math.abs(value - (signature.centroid[axis] ?? Infinity)) < 1e-6),
  )

it("rebuilds a persisted variable radius identically after reopening with new native topology", async () => {
  const builds = []
  for (const _session of [0, 1]) {
    const { input, result } = await sourceBox()
    const parameters: FilletFeatureContentParametersV3 = {
      radius: 2,
      targets: [
        {
          kind: "edge",
          edge: reference(only(result.topologyCandidates, "edge", topFront), "edge"),
          variableRadius: { startRadius: 1, endRadius: 3, reverse: true },
        },
      ],
    }
    builds.push(await evaluated(featureInput("fillet", 3, parameters, input)))
  }
  const [first, second] = builds
  if (!first || !second) throw new Error("Both sessions must build.")
  expect(first.shape).toMatchObject({ valid: true, solidCount: 1 })
  expect(second.shape.volume).toBeCloseTo(first.shape.volume, 8)
  // reverse: the end radius (3) sits at the canonical start x = -10.
  expect(nearPoint(first.topologyCandidates, [-10, -3, 10])).toBe(true)
  expect(nearPoint(first.topologyCandidates, [10, -5, 10])).toBe(true)
  expect(nearPoint(second.topologyCandidates, [-10, -3, 10])).toBe(true)
})

it("keeps the variable-radius start on the same physical end after an upstream move", async () => {
  // The canonical rule compares coordinate differences, so any translation preserves it. Rotations
  // can reorder the endpoints; ADR-0151 records why that rule is kept.
  const offset = [137.25, -48.5, 12.75] as const
  const { input, result } = await sourceBox(offset)
  const moved = (s: TopologyCandidate["signature"]) =>
    topFront({
      ...s,
      centroid: [s.centroid[0] - offset[0], s.centroid[1] - offset[1], s.centroid[2] - offset[2]],
    })
  const parameters: FilletFeatureContentParametersV3 = {
    radius: 2,
    targets: [
      {
        kind: "edge",
        edge: reference(only(result.topologyCandidates, "edge", moved), "edge"),
        variableRadius: { startRadius: 1, endRadius: 3, reverse: true },
      },
    ],
  }
  const built = await evaluated(featureInput("fillet", 3, parameters, input))
  const at = (point: readonly number[]) => point.map((value, axis) => value + (offset[axis] ?? 0))
  expect(nearPoint(built.topologyCandidates, at([-10, -3, 10]))).toBe(true)
  expect(nearPoint(built.topologyCandidates, at([10, -5, 10]))).toBe(true)
})

it("fillets a face target and only the exact named output of a multi-body producer", async () => {
  const source = await sourceBox()
  const top = only(
    source.result.topologyCandidates,
    "face",
    (s) => Math.abs(s.centroid[2] - 10) < 1e-7,
  )
  const face = await evaluated(
    featureInput(
      "fillet",
      3,
      { radius: 1, targets: [{ kind: "face", face: reference(top, "face") }] },
      source.input,
    ),
  )
  expect(face.shape).toMatchObject({ valid: true, solidCount: 1 })
  // Four top edges (perimeter 64 mm) minus the corner overlaps of meeting fillets.
  expect(face.shape.volume).toBeLessThan(2400 - (1 - Math.PI / 4) * 2 * 20)
  expect(face.shape.volume).toBeGreaterThan(2400 - (1 - Math.PI / 4) * 64)
  const pattern = featureInput(
    "pattern",
    1,
    { kind: "linear", count: 2, axis: "X", spacing: 30 },
    source.input,
  )
  const patterned = await evaluated(pattern)
  const role = "pattern.instance.1"
  const body = patterned.bodies?.find(({ outputRole }) => outputRole === role)
  if (!body) throw new Error("The Pattern must publish its second exact body role.")
  const edge = reference(only(body.topologyCandidates, "edge", topFront), "edge", role)
  const built = await evaluated(
    featureInput(
      "fillet",
      3,
      { radius: 2, targets: [{ kind: "edge", edge }] },
      {
        ...pattern,
        outputRole: role,
      },
    ),
  )
  expect(built.shape).toMatchObject({ valid: true, solidCount: 1 })
  expect(built.shape.volume).toBeCloseTo(2400 - 4 * (1 - Math.PI / 4) * 20, 6)
  const unchanged = await evaluated(pattern)
  for (const output of unchanged.bodies ?? []) expect(output.shape.volume).toBeCloseTo(2400, 6)
  const wrongRole = await engine.evaluateFeature(
    featureInput("fillet", 3, { radius: 2, targets: [{ kind: "edge", edge }] }, pattern),
    vi.fn(),
  )
  expect(wrongRole).toMatchObject({
    ok: false,
    diagnostic: {
      message: "Fillet V3 references must belong to the exact dependency output role.",
    },
  })
})

it("fails with actionable diagnostics for missing and ambiguous references without leaking shapes", async () => {
  const { input, result } = await sourceBox()
  const edge = reference(only(result.topologyCandidates, "edge", topFront), "edge")
  const missing = {
    ...edge,
    semanticRole: "does.not.exist",
    signature: { ...edge.signature, geometryClass: "UNKNOWN" },
  }
  const ownedBefore = engine.getHealth().ownedShapeCount
  const failedMissing = await engine.evaluateFeature(
    featureInput("fillet", 3, { radius: 1, targets: [{ kind: "edge", edge: missing }] }, input),
    vi.fn(),
  )
  expect(failedMissing).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-feature-geometry" },
  })
  if (!failedMissing.ok)
    expect(failedMissing.diagnostic.message).not.toBe("Feature geometry evaluation failed.")
  duplicateEdges = true
  try {
    const ambiguous = await engine.evaluateFeature(
      featureInput("fillet", 3, { radius: 1, targets: [{ kind: "edge", edge }] }, input),
      vi.fn(),
    )
    expect(ambiguous).toMatchObject({
      ok: false,
      diagnostic: {
        message: "Fillet edge 1 is missing or ambiguous on the current body. Reselect the edge.",
      },
    })
  } finally {
    duplicateEdges = false
  }
  // An internal resolver exception asks for reselection; its text is never forwarded.
  edgeResolverFailure = new TypeError("Cannot read properties of undefined (reading 'kind')")
  try {
    const internal = await engine.evaluateFeature(
      featureInput("fillet", 3, { radius: 1, targets: [{ kind: "edge", edge }] }, input),
      vi.fn(),
    )
    expect(internal).toEqual({
      ok: false,
      diagnostic: {
        code: "invalid-feature-geometry",
        message: "Fillet edge 1 is missing or ambiguous on the current body. Reselect the edge.",
        userActionable: true,
      },
    })
  } finally {
    edgeResolverFailure = null
  }
  const oversized = await engine.evaluateFeature(
    featureInput("fillet", 3, { radius: 30, targets: [{ kind: "edge", edge }] }, input),
    vi.fn(),
  )
  expect(oversized).toMatchObject({
    ok: false,
    diagnostic: { message: expect.stringContaining("Reduce the radius") },
  })
  expect(engine.getHealth().ownedShapeCount).toBe(ownedBefore)
  expect((await evaluated(input)).shape.volume).toBeCloseTo(2400, 8)
})
