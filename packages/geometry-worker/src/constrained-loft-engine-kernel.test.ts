import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { featureEvaluationInputSchema } from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

let resolverFailure: Error | null = null
const engine = new ReplicadGeometryEngine(undefined, (references, candidates) => {
  if (resolverFailure) throw resolverFailure
  const ids = references.map((reference) =>
    candidates.filter(
      (candidate) => JSON.stringify(candidate.signature) === JSON.stringify(reference.signature),
    ),
  )
  return ids.every((matches) => matches.length === 1)
    ? {
        ok: true,
        candidateIds: ids.flatMap((matches) => matches.map(({ candidateId }) => candidateId)),
      }
    : { ok: false, reason: "missing" }
})
const documentId = "constrained-loft-engine"
const boxId = "0195b5ac-b220-7a2c-8c33-67a36a7f3501"
const loftId = "0195b5ac-b220-7a2c-8c33-67a36a7f3502"
const boxHash = "a".repeat(64)
const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`

beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  const bytes = readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(bytes))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
}, 60_000)
afterEach(() => {
  resolverFailure = null
})
afterAll(() => {
  engine.disposeDocument(documentId)
  expect(engine.getHealth().ownedShapeCount).toBe(0)
})

type Dependency = { featureId: string; contentHash: string; outputRole: string }
let serial = 0
function featureInput(
  typeId: string,
  schemaVersion: number,
  parameters: unknown,
  dependencies: readonly Dependency[] = [],
  featureId = loftId,
  contentHash = (++serial).toString(16).padStart(64, "0"),
): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected exact kernel environment.")
  return featureEvaluationInputSchema.parse({
    documentId,
    featureId,
    contentHash,
    dependencies,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    content: {
      schemaVersion: dependencies.length ? 1 : 0,
      environment,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: `org.vibeshape.feature.part-design.${typeId}`,
          schemaVersion,
        },
        parameters,
        inputs: dependencies.map(({ contentHash: hash }) => hash),
        ...(dependencies.length ? { inputRoles: dependencies.map((d) => d.outputRole) } : {}),
        references: [],
      },
    },
  })
}

/** A 4 mm square section in the plane z = `z`. */
function section(z: number) {
  const points: [number, number][] = [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ]
  const segments = points.map((start, index) => ({
    entityId: id(z * 10 + index + 1),
    type: "line" as const,
    startPointId: id(z * 10 + index + 10),
    endPointId: id(z * 10 + ((index + 1) % 4) + 10),
    start,
    end: points[(index + 1) % 4],
  }))
  return {
    sketchId: id(900 + z),
    frame: { origin: [0, 0, z], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    outer: { sourceEntityIds: segments.map(({ entityId }) => entityId), segments },
    holes: [],
  }
}

function loft(overrides: Readonly<{ guides?: unknown[]; start?: unknown[] }> = {}) {
  const sections = [section(0), section(10)]
  return {
    sections,
    ruled: false,
    outerCorrespondence: [0, 1, 2, 3].map((index) => ({
      sectionEntityIds: sections.map(({ outer }) => outer.segments[index]?.entityId),
      sectionStartPointIds: sections.map(({ outer }) => outer.segments[index]?.startPointId),
    })),
    rails: [],
    guides: overrides.guides ?? [],
    start: overrides.start ?? [],
    end: [],
  }
}

async function failure(input: FeatureEvaluationInput) {
  const result = await engine.evaluateFeature(input, vi.fn())
  if (result.ok) throw new Error("Expected the constrained Loft to fail.")
  return result.diagnostic
}

describe("Constrained Loft engine diagnostics", () => {
  it("asks for reselection instead of forwarding an internal end-support exception", async () => {
    const box = await engine.evaluateFeature(
      featureInput(
        "box",
        1,
        { width: 4, depth: 4, height: 5, centered: false, origin: [0, 0, -5] },
        [],
        boxId,
        boxHash,
      ),
      vi.fn(),
    )
    if (!box.ok) throw new Error(box.diagnostic.message)
    const top = box.result.bodies?.[0]?.topologyCandidates.find(
      ({ kind, signature }) => kind === "face" && (signature.direction?.[2] ?? 0) > 0.999,
    )
    if (!top) throw new Error("Expected the box top face.")
    const support = {
      schemaVersion: 1,
      kind: "face",
      outputRole: "result",
      signature: top.signature,
    }
    resolverFailure = new TypeError("Cannot read properties of undefined (reading 'signature')")
    const diagnostic = await failure(
      featureInput(
        "loft",
        3,
        loft({ start: [{ segmentTrack: 0, continuity: "G1", supportInputIndex: 0, support }] }),
        [{ featureId: boxId, contentHash: boxHash, outputRole: "result" }],
      ),
    )
    expect(diagnostic).toEqual({
      code: "invalid-feature-geometry",
      message:
        "Loft start support face 1 is missing or ambiguous on its exact body. Reselect the support face.",
      userActionable: true,
    })
  })

  it("marks a typed Loft continuity failure so its message reaches the task panel", async () => {
    // A guide 0.01 mm off the straight wall cannot be met by the C0 filling within tolerance.
    const guide = {
      name: "Lower-wall guide",
      segmentTrack: 0,
      continuity: "C0",
      path: {
        frame: {
          origin: [0, -2.01, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 0, 1],
          normal: [0, -1, 0],
        },
        sketchId: id(950),
        startPointId: id(301),
        sourceEntityIds: [id(300)],
        segments: [
          {
            entityId: id(300),
            type: "line",
            startPointId: id(301),
            endPointId: id(302),
            start: [-1, 5],
            end: [1, 5],
          },
        ],
      },
    }
    const diagnostic = await failure(featureInput("loft", 3, loft({ guides: [guide] })))
    expect(diagnostic.userActionable).toBe(true)
    expect(diagnostic.message).toMatch(/exceeded .*tolerance/)
  })
})
