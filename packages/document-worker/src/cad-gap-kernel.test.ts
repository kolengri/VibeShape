import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import {
  boxFeatureType,
  coneFeatureType,
  coneFeatureTypeV2,
  createLengthQuantity,
  cylinderFeatureType,
  type DocumentSnapshot,
  datumPointFeatureType,
  type FeatureRecord,
  featureRecordSchema,
} from "@vibeshape/domain"
import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerResponse,
  documentWorkerResponseSchema,
} from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { DocumentWorkerRuntime } from "./runtime"

const engine = new ReplicadGeometryEngine()
const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f3000"
const id = (suffix: number) => `0195b5ac-b220-7a2c-8c33-67a36a7f${String(3100 + suffix)}`
beforeAll(async () => {
  const filesystem = await import("node:fs")
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

type Rebuilt = Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>

async function rebuild(
  features: readonly FeatureRecord[],
  sketches: DocumentSnapshot["sketches"] = [],
): Promise<Rebuilt> {
  const messages: DocumentWorkerResponse[] = []
  const runtime = new DocumentWorkerRuntime(engine, {
    postMessage: (message) => {
      messages.push(message)
    },
  })
  try {
    await runtime.handle({
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "cad-gap-rebuild",
      documentId,
      revision: 1,
      generation: 1,
      type: "rebuildDocument",
      document: {
        schemaVersion: 0,
        id: documentId,
        revision: 1,
        name: "CAD gap regression",
        displayUnits: { length: "mm", angle: "deg" },
        variables: [],
        sketches,
        features,
        createdAt: "2026-11-10T00:00:00Z",
        updatedAt: "2026-11-10T00:00:00Z",
      },
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    })
    const rebuilt = messages.find(({ type }) => type === "documentRebuilt")
    if (rebuilt?.type !== "documentRebuilt") throw new Error(JSON.stringify(messages))
    expect(documentWorkerResponseSchema.safeParse(rebuilt).success).toBe(true)
    return rebuilt
  } finally {
    engine.disposeDocument(documentId)
    expect(engine.getHealth().ownedShapeCount).toBe(0)
  }
}

function feature(
  suffix: number,
  type: FeatureRecord["type"],
  parameters: Record<string, unknown>,
  dependencies: readonly string[] = [],
): FeatureRecord {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(suffix),
    type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
  })
}

const mm = createLengthQuantity
const origin = (x = 0, y = 0, z = 0) => ({ x: mm(x), y: mm(y), z: mm(z) })

describe("truncated cone kernel evaluation", () => {
  it.each([
    { radius: 12, topRadius: 5, height: 35, centered: false },
    { radius: 5, topRadius: 12, height: 35, centered: true },
    { radius: 30, topRadius: 0.001, height: 2, centered: false },
  ])("builds an exact frustum $radius → $topRadius over $height", async (shape) => {
    const rebuilt = await rebuild([
      feature(1, coneFeatureTypeV2.type, {
        radius: mm(shape.radius),
        topRadius: mm(shape.topRadius),
        height: mm(shape.height),
        centered: shape.centered,
        origin: origin(40, -8, 3),
      }),
    ])
    expect(rebuilt.evaluation.records).toMatchObject([{ status: "succeeded" }])
    const geometry = rebuilt.geometry[0]?.geometry
    const { radius: R, topRadius: r, height: h } = shape
    const expected = (Math.PI * h * (R ** 2 + R * r + r ** 2)) / 3
    expect(geometry?.shape).toMatchObject({ valid: true, solidCount: 1 })
    expect(Math.abs((geometry?.shape.volume ?? 0) - expected) / expected).toBeLessThan(1e-6)
    const baseZ = 3 - (shape.centered ? h / 2 : 0)
    expect(geometry?.shape.bounds.min[2]).toBeCloseTo(baseZ, 6)
    expect(geometry?.shape.bounds.max[2]).toBeCloseTo(baseZ + h, 6)
    expect(geometry?.shape.bounds.max[0]).toBeCloseTo(40 + Math.max(R, r), 6)
    const roles = geometry?.topologyCandidates.map(({ semanticRole }) => semanticRole)
    expect(roles).toEqual(
      expect.arrayContaining([
        "primitive.cone.wall",
        "primitive.cone.cap.start",
        "primitive.cone.cap.end",
        "primitive.cone.edge.start",
        "primitive.cone.edge.end",
      ]),
    )
    expect(roles).not.toContain("primitive.cone.apex")
  })

  it("replays a saved pointed cone and a zero-top version 2 cone with the same volume", async () => {
    const parameters = { radius: mm(12), height: mm(35), centered: false, origin: origin() }
    const legacy = await rebuild([feature(1, coneFeatureType.type, parameters)])
    const zeroTop = await rebuild([
      feature(1, coneFeatureTypeV2.type, { ...parameters, topRadius: mm(0) }),
    ])
    const expected = (Math.PI * 35 * 12 ** 2) / 3
    for (const rebuilt of [legacy, zeroTop]) {
      const volume = rebuilt.geometry[0]?.geometry.shape.volume ?? 0
      expect(Math.abs(volume - expected) / expected).toBeLessThan(1e-6)
      expect(
        rebuilt.geometry[0]?.geometry.topologyCandidates.map(({ semanticRole }) => semanticRole),
      ).toContain("primitive.cone.apex")
    }
  })
})

function bodyReference(rebuilt: Rebuilt, suffix: number, kind: "vertex" | "edge", near: number[]) {
  const record = rebuilt.geometry.find(({ featureId }) => featureId === id(suffix))
  const body = record?.geometry.bodies?.[0]
  const candidate = body?.topologyCandidates.find(
    ({ kind: candidateKind, signature }) =>
      candidateKind === kind &&
      (kind === "vertex" || signature.geometryClass === "CIRCLE") &&
      signature.centroid.every((value, index) => Math.abs(value - (near[index] ?? 0)) < 1e-6),
  )
  if (!body || !candidate) throw new Error(`Missing ${kind} near ${near.join(",")}.`)
  return {
    schemaVersion: 1,
    featureId: id(suffix),
    outputRole: body.outputRole,
    kind,
    ...(candidate.semanticRole ? { semanticRole: candidate.semanticRole } : {}),
    signature: candidate.signature,
  }
}

function markerCenter(rebuilt: Rebuilt, suffix: number) {
  const shape = rebuilt.geometry.find(({ featureId }) => featureId === id(suffix))?.geometry.shape
  if (!shape) throw new Error("The datum point marker is missing.")
  return shape.bounds.min.map((value, index) => (value + (shape.bounds.max[index] ?? 0)) / 2)
}

describe("datum point kernel resolution", () => {
  const box = feature(1, boxFeatureType.type, {
    width: mm(20),
    depth: mm(10),
    height: mm(6),
    centered: false,
    origin: origin(3, 4, 5),
  })
  const cylinder = feature(1, cylinderFeatureType.type, {
    radius: mm(6),
    height: mm(10),
    centered: false,
    origin: origin(5, -3, 2),
  })

  it("places explicit coordinates without any body dependency", async () => {
    const rebuilt = await rebuild([
      feature(2, datumPointFeatureType.type, {
        mode: "coordinates",
        position: origin(-7, 12.5, 30),
      }),
    ])
    expect(rebuilt.evaluation.records).toMatchObject([{ status: "succeeded" }])
    markerCenter(rebuilt, 2).forEach((value, index) => {
      expect(value).toBeCloseTo([-7, 12.5, 30][index] ?? 0, 6)
    })
  })

  it("resolves a stable box vertex to its exact corner position", async () => {
    const source = await rebuild([box])
    const corner = source.geometry[0]?.geometry.shape.bounds.max ?? []
    const reference = bodyReference(source, 1, "vertex", corner)
    const point = feature(2, datumPointFeatureType.type, { mode: "vertex", reference }, [id(1)])
    const rebuilt = await rebuild([box, point])
    expect(rebuilt.evaluation.records.map(({ status }) => status)).toEqual([
      "succeeded",
      "succeeded",
    ])
    markerCenter(rebuilt, 2).forEach((value, index) => {
      expect(value).toBeCloseTo(corner[index] ?? 0, 6)
    })
  })

  it("resolves the analytical center of a circular edge", async () => {
    const source = await rebuild([cylinder])
    const reference = bodyReference(source, 1, "edge", [5, -3, 12])
    const point = feature(2, datumPointFeatureType.type, { mode: "circle-center", reference }, [
      id(1),
    ])
    const rebuilt = await rebuild([cylinder, point])
    expect(rebuilt.evaluation.records.at(-1)).toMatchObject({ status: "succeeded" })
    markerCenter(rebuilt, 2).forEach((value, index) => {
      expect(value).toBeCloseTo([5, -3, 12][index] ?? 0, 6)
    })
  })

  it("follows a semantic box corner when the box is resized and moved", async () => {
    const source = await rebuild([box])
    const corner = source.geometry[0]?.geometry.shape.bounds.max ?? []
    const reference = bodyReference(source, 1, "vertex", corner)
    expect(reference.semanticRole).toBeDefined()
    const moved = feature(1, boxFeatureType.type, {
      width: mm(40),
      depth: mm(30),
      height: mm(16),
      centered: false,
      origin: origin(300, 400, 500),
    })
    const point = feature(2, datumPointFeatureType.type, { mode: "vertex", reference }, [id(1)])
    const rebuilt = await rebuild([moved, point])
    const movedCorner = rebuilt.geometry[0]?.geometry.shape.bounds.max ?? []
    markerCenter(rebuilt, 2).forEach((value, index) => {
      expect(value).toBeCloseTo(movedCorner[index] ?? 0, 6)
    })
  })

  it("fails clearly instead of rebinding a vertex its producer no longer has", async () => {
    const source = await rebuild([box])
    const corner = source.geometry[0]?.geometry.shape.bounds.max ?? []
    const reference = bodyReference(source, 1, "vertex", corner)
    const point = feature(2, datumPointFeatureType.type, { mode: "vertex", reference }, [id(1)])
    const rebuilt = await rebuild([cylinder, point])
    expect(rebuilt.evaluation.records.at(-1)).toMatchObject({
      featureId: id(2),
      status: "failed",
      diagnostics: [
        {
          code: "org.vibeshape.feature.datum-point-reference-unresolved",
          values: { reason: "missing" },
        },
      ],
    })
    expect(rebuilt.geometry.some(({ featureId }) => featureId === id(2))).toBe(false)
  })
})
