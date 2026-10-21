import { afterAll, beforeAll, expect, it } from "bun:test"
import { resolveSelectedEdgeCandidates } from "@vibeshape/application/selected-edge-resolution"
import { resolveShellOpeningCandidates } from "@vibeshape/application/shell-opening-resolution"
import {
  type FeatureEvaluationInput,
  ReplicadGeometryEngine,
} from "@vibeshape/geometry-worker/engine"
import type { ChamferFeatureContentParametersV3, TopologyCandidate } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
let ambiguousCatalogue = false
const engine = new ReplicadGeometryEngine(
  (references, candidates, sourceFeatureId) =>
    resolveSelectedEdgeCandidates(
      references,
      ambiguousCatalogue
        ? candidates.flatMap((candidate) =>
            candidate.kind === "edge"
              ? [candidate, { ...candidate, candidateId: `${candidate.candidateId}:duplicate` }]
              : [candidate],
          )
        : candidates,
      sourceFeatureId,
    ),
  resolveShellOpeningCandidates,
)
const documentId = "chamfer-v3-kernel"
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
): FeatureEvaluationInput {
  const current = serial++
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Native kernel must initialize before evaluation.")
  const dependencies = source
    ? [{ featureId: source.featureId, contentHash: source.contentHash, outputRole: "result" }]
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
      ? { schemaVersion: 1, feature: { ...feature, inputRoles: ["result"] }, environment }
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
function candidate(
  candidates: readonly TopologyCandidate[],
  kind: "edge" | "face",
  match: (candidate: TopologyCandidate) => boolean,
) {
  const selected = candidates.filter((value) => value.kind === kind && match(value))
  if (selected.length !== 1 || !selected[0])
    throw new Error(`Fixture requires exactly one ${kind}: ${selected.length}`)
  return selected[0]
}
function edgeRef(value: TopologyCandidate) {
  return {
    schemaVersion: 1 as const,
    kind: "edge" as const,
    outputRole: "result",
    signature: value.signature,
    ...(value.semanticRole ? { semanticRole: value.semanticRole } : {}),
  }
}
function faceRef(value: TopologyCandidate) {
  return { ...edgeRef(value), kind: "face" as const }
}
function fixtureParameters(
  candidates: readonly TopologyCandidate[],
): ChamferFeatureContentParametersV3 {
  const edge = candidate(
    candidates,
    "edge",
    ({ signature: s }) =>
      Math.abs(s.centroid[1] + 6) < 1e-7 && Math.abs(s.centroid[2] - 10) < 1e-7 && s.measure > 19,
  )
  const top = candidate(
    candidates,
    "face",
    ({ signature: s }) => Math.abs(s.centroid[2] - 10) < 1e-7,
  )
  return {
    mode: "two-distances",
    distance: 3,
    secondDistance: 1,
    measurement: "offset",
    flip: false,
    tangentPropagation: false,
    targets: [{ kind: "edge", edge: edgeRef(edge), sideFace: faceRef(top) }],
    directionOverrides: [],
  }
}
function hasVertex(candidates: readonly TopologyCandidate[], point: readonly number[]) {
  return candidates.some(
    ({ kind, signature }) =>
      kind === "vertex" &&
      point.every(
        (coordinate, axis) => Math.abs(coordinate - (signature.centroid[axis] ?? Infinity)) < 1e-6,
      ),
  )
}

it("measures asymmetric planar setbacks on the authored face and flips their exact side", async () => {
  const { input, result } = await box()
  const before = JSON.stringify(result)
  const parameters = fixtureParameters(result.topologyCandidates)
  for (const flip of [false, true]) {
    const built = await evaluate(request("chamfer", 3, { ...parameters, flip }, input))
    expect(built.shape.valid).toBe(true)
    expect(built.shape.solidCount).toBe(1)
    expect(built.shape.volume).toBeCloseTo(2400 - (20 * 3) / 2, 6)
    expect(hasVertex(built.topologyCandidates, [-10, -6 + (flip ? 1 : 3), 10])).toBe(true)
    expect(hasVertex(built.topologyCandidates, [-10, -6, flip ? 7 : 9])).toBe(true)
  }
  expect(JSON.stringify(result)).toBe(before)
  expect((await evaluate(input)).shape.volume).toBeCloseTo(2400, 8)
})

it("uses the native face-relative distance-angle convention and preserves angle on flip", async () => {
  const { input, result } = await box()
  const { secondDistance: _second, ...common } = fixtureParameters(result.topologyCandidates)
  for (const flip of [false, true]) {
    const built = await evaluate(
      request(
        "chamfer",
        3,
        { ...common, mode: "distance-angle", distance: 2, angle: Math.PI / 6, flip },
        input,
      ),
    )
    const other = 2 * Math.tan(Math.PI / 6)
    expect(built.shape.volume).toBeCloseTo(2400 - 20 * other, 6)
    expect(hasVertex(built.topologyCandidates, [-10, -6 + (flip ? other : 2), 10])).toBe(true)
    expect(hasVertex(built.topologyCandidates, [-10, -6, 10 - (flip ? 2 : other)])).toBe(true)
  }
})

it("applies global flip XOR independent edge overrides, and expands an exact selected face", async () => {
  const { input, result } = await box()
  const parameters = fixtureParameters(result.topologyCandidates)
  const other = candidate(
    result.topologyCandidates,
    "edge",
    ({ signature: s }) =>
      Math.abs(s.centroid[1] - 6) < 1e-7 && Math.abs(s.centroid[2] - 10) < 1e-7 && s.measure > 19,
  )
  const first = parameters.targets[0]
  if (first?.kind !== "edge" || !first.sideFace)
    throw new Error("Authored side fixture is required.")
  const built = await evaluate(
    request(
      "chamfer",
      3,
      {
        ...parameters,
        flip: true,
        targets: [
          ...parameters.targets,
          { kind: "edge", edge: edgeRef(other), sideFace: first.sideFace },
        ],
        directionOverrides: [edgeRef(other)],
      },
      input,
    ),
  )
  expect(built.shape.volume).toBeCloseTo(2340, 6)
  expect(hasVertex(built.topologyCandidates, [-10, -5, 10])).toBe(true)
  expect(hasVertex(built.topologyCandidates, [-10, 3, 10])).toBe(true)
  const face = await evaluate(
    request(
      "chamfer",
      3,
      {
        mode: "equal-distance",
        distance: 1,
        measurement: "tangent",
        flip: false,
        tangentPropagation: true,
        targets: [{ kind: "face", face: first.sideFace }],
        directionOverrides: [],
      },
      input,
    ),
  )
  expect(face.shape.valid).toBe(true)
  expect(face.shape.solidCount).toBe(1)
  expect(face.shape.volume).toBeLessThan(2400)
})

it("proves Offset and Tangent coincide on planar supports and rejects wrong adjacent face intent", async () => {
  const { input, result } = await box()
  const parameters = fixtureParameters(result.topologyCandidates)
  const a = await evaluate(request("chamfer", 3, parameters, input))
  const b = await evaluate(request("chamfer", 3, { ...parameters, measurement: "tangent" }, input))
  expect(b.shape.volume).toBeCloseTo(a.shape.volume, 8)
  const unrelated = candidate(
    result.topologyCandidates,
    "face",
    ({ signature: s }) => Math.abs(s.centroid[0] - 10) < 1e-7,
  )
  const target = parameters.targets[0]
  if (target?.kind !== "edge") throw new Error("Selected edge fixture is required.")
  const failed = await engine.evaluateFeature(
    request(
      "chamfer",
      3,
      { ...parameters, targets: [{ ...target, sideFace: faceRef(unrelated) }] },
      input,
    ),
    vi.fn(),
  )
  expect(failed).toMatchObject({
    ok: false,
    diagnostic: { message: "Chamfer side face is not adjacent to its selected edge." },
  })
})

it("modifies only the exact named output role of a multi-body producer", async () => {
  const source = await box()
  const pattern = request(
    "pattern",
    1,
    { kind: "linear", count: 2, axis: "X", spacing: 30 },
    source.input,
  )
  const patterned = await evaluate(pattern)
  const body = patterned.bodies?.find(({ outputRole }) => outputRole === "pattern.instance.1")
  if (!body) throw new Error("The Pattern must publish its second exact body role.")
  const parameters = fixtureParameters(body.topologyCandidates)
  const first = parameters.targets[0]
  if (first?.kind !== "edge" || !first.sideFace)
    throw new Error("An exact planar edge and side are required.")
  const typed = {
    ...parameters,
    targets: [
      {
        ...first,
        edge: { ...first.edge, outputRole: body.outputRole },
        sideFace: { ...first.sideFace, outputRole: body.outputRole },
      },
    ],
  }
  const input = request("chamfer", 3, typed, pattern)
  if (input.content.schemaVersion !== 1)
    throw new Error("Named dependencies require named content identity.")
  const scoped = {
    ...input,
    content: {
      ...input.content,
      feature: { ...input.content.feature, inputRoles: [body.outputRole] },
    },
    dependencies: [
      {
        featureId: pattern.featureId,
        contentHash: pattern.contentHash,
        outputRole: body.outputRole,
      },
    ],
  }
  const built = await evaluate(scoped)
  expect(built.shape.solidCount).toBe(1)
  expect(built.shape.volume).toBeCloseTo(2370, 6)
  expect(hasVertex(built.topologyCandidates, [20, -3, 10])).toBe(true)
  const unchanged = await evaluate(pattern)
  expect(unchanged.shape.volume).toBeCloseTo(4800, 6)
  expect(unchanged.bodies).toHaveLength(2)
  for (const output of unchanged.bodies ?? []) expect(output.shape.volume).toBeCloseTo(2400, 6)
})

it("fails closed for missing refs, oversized geometry and out-of-selection direction overrides", async () => {
  const { input, result } = await box()
  const parameters = fixtureParameters(result.topologyCandidates)
  const first = parameters.targets[0]
  if (first?.kind !== "edge") throw new Error("Selected edge fixture is required.")
  const missing = {
    ...first.edge,
    semanticRole: "does.not.exist",
    signature: { ...first.edge.signature, geometryClass: "UNKNOWN" },
  }
  const outside = candidate(
    result.topologyCandidates,
    "edge",
    ({ signature: s }) =>
      Math.abs(s.centroid[1] - 6) < 1e-7 && Math.abs(s.centroid[2]) < 1e-7 && s.measure > 19,
  )
  for (const patch of [
    { distance: 30, secondDistance: 30 },
    { targets: [{ ...first, edge: missing }] },
    { directionOverrides: [edgeRef(outside)] },
  ]) {
    const ownedBefore = engine.getHealth().ownedShapeCount
    const failed = await engine.evaluateFeature(
      request("chamfer", 3, { ...parameters, ...patch }, input),
      vi.fn(),
    )
    expect(failed.ok).toBe(false)
    expect(engine.getHealth().ownedShapeCount).toBe(ownedBefore)
    if (!failed.ok)
      expect(failed.diagnostic.message).not.toBe("Feature geometry evaluation failed.")
    expect((await evaluate(input)).shape.volume).toBeCloseTo(2400, 8)
  }
})

it("reports ambiguity from a duplicated exact topology catalogue without constructing a wrong edge", async () => {
  const { input, result } = await box()
  const parameters = fixtureParameters(result.topologyCandidates)
  const ownedBefore = engine.getHealth().ownedShapeCount
  ambiguousCatalogue = true
  try {
    const failed = await engine.evaluateFeature(request("chamfer", 3, parameters, input), vi.fn())
    expect(failed).toMatchObject({
      ok: false,
      diagnostic: { message: expect.stringContaining("ambiguous and requires repair") },
    })
    expect(engine.getHealth().ownedShapeCount).toBe(ownedBefore)
  } finally {
    ambiguousCatalogue = false
  }
  expect((await evaluate(input)).shape.volume).toBeCloseTo(2400, 8)
})

it("measures body-bound circular Offset and rejects unproved curved modes and periodic seams", async () => {
  const input = request("cylinder", 1, {
    radius: 10,
    height: 20,
    centered: false,
    origin: [0, 0, 0],
  })
  const result = await evaluate(input)
  const rim = candidate(
    result.topologyCandidates,
    "edge",
    ({ signature: s }) => s.geometryClass === "CIRCLE" && Math.abs(s.centroid[2] - 20) < 1e-6,
  )
  const seam = candidate(
    result.topologyCandidates,
    "edge",
    ({ signature: s }) => s.geometryClass === "LINE",
  )
  const top = candidate(
    result.topologyCandidates,
    "face",
    ({ signature: s }) => s.geometryClass === "PLANE" && Math.abs(s.centroid[2] - 20) < 1e-6,
  )
  const parameters: ChamferFeatureContentParametersV3 = {
    mode: "equal-distance",
    distance: 1,
    measurement: "offset",
    flip: false,
    tangentPropagation: false,
    targets: [{ kind: "edge", edge: edgeRef(rim) }],
    directionOverrides: [],
  }
  for (const distance of [0.25, 1, 3]) {
    const built = await evaluate(request("chamfer", 3, { ...parameters, distance }, input))
    expect(built.shape.valid).toBe(true)
    expect(built.shape.solidCount).toBe(1)
    expect(built.shape.volume).toBeCloseTo(
      Math.PI * (2000 - 10 * distance ** 2 + distance ** 3 / 3),
      6,
    )
    for (const [radius, height] of [
      [10 - distance, 20],
      [10, 20 - distance],
    ])
      expect(
        built.topologyCandidates.some(
          ({ referenceGeometry: g }) =>
            g?.kind === "circle-edge" &&
            Math.abs(g.radius - (radius ?? Infinity)) < 1e-6 &&
            Math.abs(g.center[2] - (height ?? Infinity)) < 1e-6,
        ),
      ).toBe(true)
  }
  const face = await evaluate(
    request(
      "chamfer",
      3,
      {
        ...parameters,
        targets: [{ kind: "face", face: faceRef(top) }],
      },
      input,
    ),
  )
  expect(face.shape.volume).toBeCloseTo(Math.PI * (2000 - 10 + 1 / 3), 6)
  const directed = [{ kind: "edge", edge: edgeRef(rim), sideFace: faceRef(top) }]
  for (const patch of [
    { measurement: "tangent" },
    { mode: "two-distances", secondDistance: 2, targets: directed },
    { mode: "distance-angle", angle: Math.PI / 6, targets: directed },
  ]) {
    const ownedBefore = engine.getHealth().ownedShapeCount
    const failed = await engine.evaluateFeature(
      request("chamfer", 3, { ...parameters, ...patch }, input),
      vi.fn(),
    )
    expect(failed).toMatchObject({
      ok: false,
      diagnostic: { message: expect.stringContaining("non-planar adjacent faces is unsupported") },
    })
    expect(engine.getHealth().ownedShapeCount).toBe(ownedBefore)
  }
  const failed = await engine.evaluateFeature(
    request(
      "chamfer",
      3,
      {
        mode: "equal-distance",
        distance: 1,
        measurement: "offset",
        flip: false,
        tangentPropagation: true,
        targets: [{ kind: "edge", edge: edgeRef(seam) }],
        directionOverrides: [],
      },
      input,
    ),
    vi.fn(),
  )
  expect(failed).toMatchObject({
    ok: false,
    diagnostic: { message: expect.stringContaining("seam, degenerate, or non-manifold") },
  })
  expect((await evaluate(input)).shape.volume).toBeCloseTo(Math.PI * 2000, 6)
})

it.each(["fillet", "chamfer"] as const)(
  "distinguishes legacy %s geometric failure from reference repair without exposing native errors",
  async (operation) => {
    const source = request("cylinder", 1, {
      radius: 10,
      height: 20,
      centered: false,
      origin: [0, 0, 0],
    })
    const result = await evaluate(source)
    const rim = candidate(
      result.topologyCandidates,
      "edge",
      ({ signature: s }) => s.geometryClass === "CIRCLE" && Math.abs(s.centroid[2] - 20) < 1e-6,
    )
    const reference = {
      schemaVersion: 0 as const,
      inputIndex: 0,
      kind: "edge" as const,
      signature: rim.signature,
      ...(rim.semanticRole ? { semanticRole: rim.semanticRole } : {}),
    }
    const dimension = operation === "fillet" ? "radius" : "distance"
    const selected = (size: number, selectedReference = reference) => {
      const input = request(operation, 2, { [dimension]: size }, source)
      if (input.content.schemaVersion !== 1)
        throw new Error("The selected treatment fixture requires named dependency content.")
      return {
        ...input,
        content: {
          ...input.content,
          feature: { ...input.content.feature, references: [selectedReference] },
        },
      }
    }
    const ownedBefore = engine.getHealth().ownedShapeCount
    const oversized = await engine.evaluateFeature(selected(30), vi.fn())
    expect(oversized).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature-geometry",
        message: expect.stringContaining(`Reduce the ${dimension} or choose another edge`),
      },
    })
    const missing = await engine.evaluateFeature(
      selected(1, {
        ...reference,
        semanticRole: "missing.edge",
        signature: { ...reference.signature, geometryClass: "UNKNOWN" },
      }),
      vi.fn(),
    )
    expect(missing).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature-parameters",
        message: expect.stringContaining("missing or invalid. Reselect"),
      },
    })
    ambiguousCatalogue = true
    try {
      const ambiguous = await engine.evaluateFeature(selected(1), vi.fn())
      expect(ambiguous).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-feature-parameters",
          message: expect.stringContaining("ambiguous. Reselect"),
        },
      })
    } finally {
      ambiguousCatalogue = false
    }
    expect(engine.getHealth().ownedShapeCount).toBe(ownedBefore)
    expect((await evaluate(source)).shape.volume).toBeCloseTo(Math.PI * 2000, 6)
    const boxSource = await box()
    expect(
      await engine.evaluateFeature(
        request(operation, 1, { [dimension]: 30 }, boxSource.input),
        vi.fn(),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature-geometry",
        message: expect.stringContaining(`Reduce the ${dimension} or choose another edge`),
      },
    })
    expect((await evaluate(boxSource.input)).shape.volume).toBeCloseTo(2400, 8)
  },
)
