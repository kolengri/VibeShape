import { featureEvaluationEngineResultSchema } from "@vibeshape/protocol"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { type FeatureEvaluationInput, ReplicadGeometryEngine } from "./engine"

const pyramidFixtures = [
  ...[3, 4, 6, 64].map((sides) => ({
    sides,
    radius: 12,
    height: 35,
    origin: [40, -8, 0] as const,
    centered: sides !== 3,
  })),
  { sides: 64, radius: 0.001, height: 0.001, origin: [0, 0, 0] as const, centered: true },
].map(({ sides, radius, height, origin, centered }) => {
  const vertices = Array.from({ length: sides }, (_, index) => {
    const angle = (2 * Math.PI * index) / sides
    return [origin[0] + radius * Math.cos(angle), origin[1] + radius * Math.sin(angle)]
  })
  const baseZ = origin[2] - (centered ? height / 2 : 0)
  return {
    kind: "pyramid" as const,
    parameters: { sides, radius, height, centered, origin },
    volume: (sides * radius ** 2 * Math.sin((2 * Math.PI) / sides) * height) / 6,
    minimum: [
      Math.min(...vertices.map((v) => v[0] ?? 0)),
      Math.min(...vertices.map((v) => v[1] ?? 0)),
      baseZ,
    ],
    maximum: [
      Math.max(...vertices.map((v) => v[0] ?? 0)),
      Math.max(...vertices.map((v) => v[1] ?? 0)),
      baseZ + height,
    ],
    roles: [
      "primitive.pyramid.base",
      ...Array.from({ length: sides }, (_, index) => `primitive.pyramid.side.${index}`),
    ],
  }
})

const fixtures = [
  ...pyramidFixtures,
  {
    kind: "sphere",
    parameters: { radius: 8, origin: [-30, 5, 6] },
    volume: (4 / 3) * Math.PI * 8 ** 3,
    minimum: [-38, -3, -2],
    maximum: [-22, 13, 14],
    roles: ["primitive.sphere.surface"],
  },
  {
    kind: "cone",
    parameters: { radius: 12, height: 35, centered: false, origin: [40, -8, 0] },
    volume: (Math.PI * 12 ** 2 * 35) / 3,
    minimum: [28, -20, 0],
    maximum: [52, 4, 35],
    roles: ["primitive.cone.wall", "primitive.cone.cap.start"],
  },
  {
    kind: "cone",
    parameters: { radius: 12, height: 35, centered: true, origin: [40, -8, 0] },
    volume: (Math.PI * 12 ** 2 * 35) / 3,
    minimum: [28, -20, -17.5],
    maximum: [52, 4, 17.5],
    roles: ["primitive.cone.wall", "primitive.cone.cap.start"],
  },
  {
    kind: "torus",
    parameters: { majorRadius: 30, minorRadius: 10, origin: [0, 30, 5] },
    volume: 2 * Math.PI ** 2 * 30 * 10 ** 2,
    minimum: [-40, -10, -5],
    maximum: [40, 70, 15],
    roles: ["primitive.torus.surface"],
  },
] as const
const engine = new ReplicadGeometryEngine()
const documentId = "native-radial-primitives"
beforeAll(async () => {
  const filesystem = await vi.importActual<{ readFileSync(path: URL): Uint8Array }>("node:fs")
  const wasmBinary = filesystem.readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(wasmBinary))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
})
afterAll(() => {
  engine.disposeDocument(documentId)
})
function request(fixture: (typeof fixtures)[number]): FeatureEvaluationInput {
  const environment = engine.getFeatureContentEnvironment()
  if (!environment) throw new Error("Expected initialized geometry environment")
  return {
    documentId,
    featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
    contentHash: "a".repeat(64),
    content: {
      schemaVersion: 0,
      feature: {
        schemaVersion: 0,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: `org.vibeshape.feature.part-design.${fixture.kind}`,
          schemaVersion: 1,
        },
        parameters: { ...fixture.parameters, origin: [...fixture.parameters.origin] },
        inputs: [],
        references: [],
      },
      environment,
    },
    dependencies: [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}

describe("real kernel primitive evaluation pipeline", () => {
  it.each(fixtures)(
    "evaluates, tessellates, names, caches, and disposes $kind $parameters",
    async (fixture) => {
      try {
        const input = request(fixture)
        const evaluated = await engine.evaluateFeature(input, vi.fn())
        if (!evaluated.ok) throw new Error(evaluated.diagnostic.message)
        const result = evaluated.result
        expect(featureEvaluationEngineResultSchema.safeParse(result).success).toBe(true)
        if (fixture.kind === "cone") {
          const degenerated = result.topologyCandidates.filter(
            ({ kind, signature }) => kind === "edge" && signature.measure === 0,
          )
          expect(degenerated).toHaveLength(1)
          expect(degenerated[0]).not.toHaveProperty("referenceGeometry")
          expect(degenerated[0]).not.toHaveProperty("edgePolyline")
          expect(
            result.topologyCandidates.find(
              ({ semanticRole }) => semanticRole === "primitive.cone.apex",
            )?.referenceGeometry,
          ).toMatchObject({ kind: "vertex" })
        }
        if (fixture.kind === "pyramid") {
          expect(result.topologyCandidates.filter(({ kind }) => kind === "face")).toHaveLength(
            fixture.parameters.sides + 1,
          )
          expect(result.topologyCandidates.filter(({ kind }) => kind === "edge")).toHaveLength(
            fixture.parameters.sides * 2,
          )
          expect(result.topologyCandidates.filter(({ kind }) => kind === "vertex")).toHaveLength(
            fixture.parameters.sides + 1,
          )
          expect(
            new Set(result.topologyCandidates.flatMap(({ semanticRole }) => semanticRole ?? []))
              .size,
          ).toBe(fixture.parameters.sides * 4 + 2)
          expect(
            result.topologyCandidates.find(
              ({ semanticRole }) => semanticRole === "primitive.pyramid.apex",
            )?.referenceGeometry,
          ).toMatchObject({
            kind: "vertex",
            position: [
              fixture.parameters.origin[0],
              fixture.parameters.origin[1],
              fixture.maximum[2],
            ],
          })
        }
        expect(result.shape).toMatchObject({ valid: true, solidCount: 1 })
        expect(result.shape.volume / fixture.volume).toBeCloseTo(1, 7)
        for (let axis = 0; axis < 3; axis += 1) {
          expect(result.shape.bounds.min[axis]).toBeCloseTo(fixture.minimum[axis] ?? 0, 5)
          expect(result.shape.bounds.max[axis]).toBeCloseTo(fixture.maximum[axis] ?? 0, 5)
        }
        expect(
          result.topologyCandidates
            .filter(({ kind }) => kind === "face")
            .flatMap(({ semanticRole }) => semanticRole ?? [])
            .sort(),
        ).toEqual([...fixture.roles].sort())
        expect(result.bodies?.map(({ outputRole }) => outputRole)).toEqual(["result"])
        expect(result.mesh.indices.length).toBeGreaterThan(0)
        expect(result.cache.brepHit).toBe(false)
        const cached = await engine.evaluateFeature(input, vi.fn())
        expect(cached).toMatchObject({ ok: true, result: { cache: { brepHit: true } } })
        expect(engine.getHealth().ownedShapeCount).toBe(1)
      } finally {
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
      }
    },
  )
})
