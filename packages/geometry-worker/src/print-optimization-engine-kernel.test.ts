import { afterAll, beforeAll, expect, it } from "bun:test"
import {
  featureContentIdentitySchema,
  featureEvaluationInputSchema,
  serializeFeatureContentIdentity,
} from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { ReplicadGeometryEngine } from "./engine"

const engine = new ReplicadGeometryEngine()
const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
let metadata: Awaited<ReturnType<typeof engine.initialize>>
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
    metadata = await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
})
afterAll(() => engine.disposeDocument(documentId))

it("uses only the active exact source identity and leaves its cache and display face IDs intact", async () => {
  const content = featureContentIdentitySchema.parse({
    schemaVersion: 0,
    environment: metadata.featureContentEnvironment,
    feature: {
      schemaVersion: 0,
      type: {
        moduleId: "org.vibeshape.core.part-design",
        moduleVersion: "0.1.0",
        typeId: "org.vibeshape.feature.part-design.box",
        schemaVersion: 1,
      },
      parameters: { width: 12, depth: 12, height: 6, centered: false, origin: [0, 0, 0] },
      inputs: [],
      references: [],
    },
  })
  const contentHash = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(serializeFeatureContentIdentity(content)),
      ),
    ),
  ]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
  const input = featureEvaluationInputSchema.parse({
    documentId,
    featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
    content,
    contentHash,
    dependencies: [],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  })
  const evaluated = await engine.evaluateFeature(input, () => {})
  if (!evaluated.ok) throw new Error(JSON.stringify(evaluated))
  const mesh = evaluated.result.mesh
  let preserved: number | undefined
  for (let triangle = 0; triangle < mesh.triangleFaceIds.length; triangle++) {
    const indices = mesh.indices.slice(triangle * 3, triangle * 3 + 3)
    if (indices.every((index) => Math.abs((mesh.positions[index * 3] ?? 0) + 6) < 1e-6))
      preserved = mesh.triangleFaceIds[triangle]
  }
  if (!preserved) throw new Error("Missing fixture face.")
  const cells: [number, number, number][] = []
  for (let z = 0; z < 6; z++)
    for (let y = 0; y < 12; y++) for (let x = 0; x < 10; x++) cells.push([x, y, z])
  const request = {
    source: { documentId, featureId: input.featureId, contentHash, outputRole: "result" },
    preserveFaceIds: [preserved],
    voxelGrid: { originMm: [-6, -6, 0] as [number, number, number], cellSizeMm: 1, cells },
    sourceToPrintFrame: {
      originMm: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    },
    protectedBoxes: [],
    preserveDepthMm: 1,
  }
  const count = engine.getHealth().ownedShapeCount
  const result = await engine.reconstructPrintOptimization(request)
  expect(result.volumeMm3).toBeCloseTo(720, 6)
  expect(result.preservedFaceCount).toBe(1)
  expect(engine.getHealth().ownedShapeCount).toBe(count)
  const cached = await engine.evaluateFeature(input, () => {})
  if (!cached.ok) throw new Error(JSON.stringify(cached))
  expect(cached.result.cache.brepHit).toBe(true)
  expect(cached.result.mesh).toEqual(mesh)
  expect(cached.result.shape.volume).toBeCloseTo(864, 7)
  await expect(
    engine.reconstructPrintOptimization({
      ...request,
      source: { ...request.source, contentHash: "0".repeat(64) },
    }),
  ).rejects.toThrow("stale or unavailable")
  await expect(
    engine.reconstructPrintOptimization({
      ...request,
      source: { ...request.source, outputRole: "missing" },
    }),
  ).rejects.toThrow("stale or unavailable")
  await expect(
    engine.reconstructPrintOptimization({ ...request, preserveFaceIds: [2_147_483_646] }),
  ).rejects.toThrow("stale")
  engine.disposeDocument(documentId)
  await expect(engine.reconstructPrintOptimization(request)).rejects.toThrow("stale or unavailable")
})
