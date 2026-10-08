import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import {
  featureContentIdentitySchema,
  featureEvaluationInputSchema,
  importedSourceMaterializationSchema,
  inspectSourceImportInputSchema,
  serializeFeatureContentIdentity,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import { vi } from "../../../tests/unit/support/bun-test"
import { ReplicadGeometryEngine } from "./engine"
import * as sourceImport from "./occt-source-import"

const documentId = "single-output-import-kernel"
const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const mesh = { chordTolerance: 0.05, angularTolerance: 0.1 }
let engine: ReplicadGeometryEngine
let metadata: Awaited<ReturnType<ReplicadGeometryEngine["initialize"]>>
const nativeRebuild = sourceImport.rebuildOcctSourceImport
async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")
}
function success<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(JSON.stringify(value))
  return value as Extract<T, { ok: true }>
}
async function input(featureId: string, name: string, parameters: unknown) {
  const content = featureContentIdentitySchema.parse({
    schemaVersion: 0,
    environment: metadata.featureContentEnvironment,
    feature: {
      schemaVersion: 0,
      type: {
        moduleId: "org.vibeshape.core.part-design",
        moduleVersion: "0.1.0",
        typeId: `org.vibeshape.feature.part-design.${name}`,
        schemaVersion: 1,
      },
      parameters,
      inputs: [],
      references: [],
    },
  })
  return featureEvaluationInputSchema.parse({
    documentId,
    featureId,
    content,
    contentHash: await digest(new TextEncoder().encode(serializeFeatureContentIdentity(content))),
    dependencies: [],
    mesh,
  })
}
async function fixture(count = 1) {
  const original = await input(id(1), "box", {
    width: 12,
    depth: 8,
    height: 6,
    centered: false,
    origin: [0, 0, 0],
  })
  success(await engine.evaluateFeature(original, vi.fn()))
  const features = [
    { featureId: original.featureId, contentHash: original.contentHash, outputRole: "result" },
  ]
  if (count === 2) {
    const second = await input(id(2), "box", {
      width: 2,
      depth: 2,
      height: 2,
      centered: false,
      origin: [20, 0, 0],
    })
    success(await engine.evaluateFeature(second, vi.fn()))
    features.push({
      featureId: second.featureId,
      contentHash: second.contentHash,
      outputRole: "result",
    })
  }
  const { file: bytes } = await engine.exportDocument({ documentId, features, format: "step" })
  const source = {
    digest: await digest(bytes),
    byteLength: bytes.byteLength,
    format: "step",
    normalization: {
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    },
    unitPolicy: "step-system-mm",
    readerPolicyVersion: 1,
  }
  const inspection = await engine.inspectSourceImport(
    inspectSourceImportInputSchema.parse({ source, bytes, mesh }),
  )
  expect(inspection.outputs).toHaveLength(count)
  const outputs = inspection.outputs.map(({ signature }, index) => ({
    outputId: id(100 + index),
    signature,
  }))
  const content = { source, outputs, matchingPolicyVersion: 1 }
  const asset = {
    id: id(50),
    digest: source.digest,
    byteLength: bytes.byteLength,
    filename: "Box.step",
    format: "step",
    representation: "exact-solid",
    normalization: source.normalization,
    outputs: outputs.map(({ outputId }) => outputId),
  }
  return {
    original,
    bytes,
    request: await input(id(3), "imported", content),
    materialized: importedSourceMaterializationSchema.parse({
      sourceAssetId: asset.id,
      content,
      asset,
      bytes,
    }),
  }
}
function captureOutputs(onOutput: (shape: Shape3D) => void) {
  return vi.spyOn(sourceImport, "rebuildOcctSourceImport").mockImplementation(async (...args) => {
    const outputs = await nativeRebuild(...args)
    for (const { shape } of outputs) onOutput(shape)
    return outputs
  })
}
async function unchangedSource(original: Awaited<ReturnType<typeof input>>) {
  expect(success(await engine.evaluateFeature(original, vi.fn())).result).toMatchObject({
    shape: { valid: true, solidCount: 1, volume: 576 },
    cache: { brepHit: true },
  })
}
beforeAll(async () => {
  const filesystem = await import("node:fs/promises")
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          Uint8Array.from(
            await filesystem.readFile(
              url.startsWith("/@fs/")
                ? url.slice(4)
                : url.startsWith("/") && !url.startsWith("/assets/")
                  ? url
                  : `.${url}`,
            ),
          ),
        ),
    ),
  )
  engine = new ReplicadGeometryEngine()
  metadata = await engine.initialize()
}, 60_000)
afterEach(() => {
  engine.disposeDocument(documentId)
  expect(engine.getHealth().ownedShapeCount).toBe(0)
  vi.restoreAllMocks()
})
afterAll(() => vi.unstubAllGlobals())

describe("exact source import through the native feature engine", () => {
  it("retains independent aggregate and named wrappers for a single STEP solid", async () => {
    const prepared = await fixture()
    const bytes = Uint8Array.from(prepared.bytes)
    let named: Shape3D | undefined
    let aggregate: Shape3D | undefined
    const deleted: ReturnType<typeof vi.spyOn>[] = []
    captureOutputs((shape) => {
      named = shape
      deleted.push(vi.spyOn(shape, "delete"))
      const clone = shape.clone.bind(shape)
      vi.spyOn(shape, "clone").mockImplementation(() => {
        aggregate = clone()
        deleted.push(vi.spyOn(aggregate, "delete"))
        return aggregate
      })
    })
    const result = success(
      await engine.evaluateFeature(prepared.request, vi.fn(), prepared.materialized),
    ).result
    expect(result.shape).toMatchObject({
      valid: true,
      solidCount: 1,
      volume: 576,
      surfaceArea: 432,
    })
    expect(result.bodies).toHaveLength(1)
    expect(result.bodies?.[0]).toMatchObject({
      outputRole: `import.${id(100)}`,
      shape: { valid: true, solidCount: 1, volume: 576 },
    })
    expect(result.bodies?.[0]?.mesh.indices.length).toBeGreaterThan(0)
    expect(named).toBeDefined()
    expect(aggregate).toBeDefined()
    expect(aggregate).not.toBe(named)
    expect(aggregate?.wrapped.IsEqual(named?.wrapped as never)).toBe(true)
    expect(engine.getHealth().ownedShapeCount).toBe(3)
    for (const release of deleted) expect(release).not.toHaveBeenCalled()
    const cached = success(
      await engine.evaluateFeature(prepared.request, vi.fn(), prepared.materialized),
    ).result
    expect(cached.cache.brepHit).toBe(true)
    expect(cached.bodies).toHaveLength(1)
    expect(cached.bodies?.[0]?.shape.volume).toBeCloseTo(576, 7)
    await unchangedSource(prepared.original)
    expect(prepared.materialized.bytes).toEqual(bytes)
    engine.disposeDocument(documentId)
    for (const release of deleted) expect(release).toHaveBeenCalledTimes(1)
    engine.disposeDocument(documentId)
    for (const release of deleted) expect(release).toHaveBeenCalledTimes(1)
  })
  it("releases the owned imported output after cloning fails without disposing the source", async () => {
    const prepared = await fixture()
    const deleted: ReturnType<typeof vi.spyOn>[] = []
    captureOutputs((shape) => {
      deleted.push(vi.spyOn(shape, "delete"))
      vi.spyOn(shape, "clone").mockImplementation(() => {
        throw new Error("Native clone failed.")
      })
    })
    expect(
      await engine.evaluateFeature(prepared.request, vi.fn(), prepared.materialized),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-geometry" },
    })
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).toHaveBeenCalledTimes(1)
    expect(engine.getHealth().ownedShapeCount).toBe(1)
    await unchangedSource(prepared.original)
    vi.restoreAllMocks()
    expect(
      success(await engine.evaluateFeature(prepared.request, vi.fn(), prepared.materialized)).result
        .shape,
    ).toMatchObject({ valid: true, solidCount: 1, volume: 576 })
  })
  it("releases both wrappers after aggregate native inspection fails", async () => {
    const prepared = await fixture()
    const deleted: ReturnType<typeof vi.spyOn>[] = []
    captureOutputs((shape) => {
      deleted.push(vi.spyOn(shape, "delete"))
      const clone = shape.clone.bind(shape)
      vi.spyOn(shape, "clone").mockImplementation(() => {
        const aggregate = clone()
        deleted.push(vi.spyOn(aggregate, "delete"))
        vi.spyOn(aggregate, "wrapped", "get").mockImplementationOnce(() => {
          throw new Error("Native shape access failed.")
        })
        return aggregate
      })
    })
    expect(
      await engine.evaluateFeature(prepared.request, vi.fn(), prepared.materialized),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-geometry" },
    })
    expect(deleted).toHaveLength(2)
    for (const release of deleted) expect(release).toHaveBeenCalledTimes(1)
    expect(engine.getHealth().ownedShapeCount).toBe(1)
    await unchangedSource(prepared.original)
  })
  it("preserves the existing compound path and named outputs for a two-solid STEP", async () => {
    const prepared = await fixture(2)
    const clones: ReturnType<typeof vi.spyOn>[] = []
    captureOutputs((shape) => clones.push(vi.spyOn(shape, "clone")))
    const result = success(
      await engine.evaluateFeature(prepared.request, vi.fn(), prepared.materialized),
    ).result
    expect(result.shape).toMatchObject({ valid: true, solidCount: 2, volume: 584 })
    expect(result.bodies?.map(({ outputRole }) => outputRole)).toEqual([
      `import.${id(100)}`,
      `import.${id(101)}`,
    ])
    expect(result.bodies?.[0]?.shape.volume).toBeCloseTo(576, 7)
    expect(result.bodies?.[1]?.shape.volume).toBeCloseTo(8, 7)
    for (const clone of clones) expect(clone).not.toHaveBeenCalled()
    await unchangedSource(prepared.original)
  })
})
