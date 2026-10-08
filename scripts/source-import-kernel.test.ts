import { testAssetPath } from "../tests/unit/support/assets"
/// <reference path="../packages/geometry-worker/src/vite-modules.d.ts" />

import { expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { ReplicadGeometryEngine } from "../packages/geometry-worker/src/engine"
import {
  featureContentIdentitySchema,
  serializeFeatureContentIdentity,
} from "../packages/protocol/src/index"
import { vi } from "../tests/unit/support/bun-test"

const id = (n: number) => `0195b5ac-b270-7a2c-8c33-${String(n).padStart(12, "0")}`
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")
}

function binaryStlVolume(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  expect(bytes.byteLength).toBe(84 + count * 50)
  let volume = 0
  for (let index = 0; index < count; index++) {
    const start = 84 + index * 50 + 12
    const vertex = (offset: number) =>
      [
        view.getFloat32(start + offset, true),
        view.getFloat32(start + offset + 4, true),
        view.getFloat32(start + offset + 8, true),
      ] as const
    const a = vertex(0),
      b = vertex(12),
      c = vertex(24)
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6
  }
  return Math.abs(volume)
}

it("inspects and rebuilds immutable multi-body STEP sources, verifies cache bytes and exports exact captured outputs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(await readFile(resolve(testAssetPath(url))))),
  )
  const engine = new ReplicadGeometryEngine()
  const metadata = await engine.initialize()
  const documentId = id(1)
  const evaluate = async (
    featureId: string,
    name: string,
    parameters: unknown,
    source?: Parameters<typeof engine.evaluateFeature>[2],
  ) => {
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
    const contentHash = await digest(
      new TextEncoder().encode(serializeFeatureContentIdentity(content)),
    )
    return {
      ...(await engine.evaluateFeature(
        {
          documentId,
          featureId,
          content,
          contentHash,
          dependencies: [],
          mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        },
        vi.fn(),
        source,
      )),
      contentHash,
    }
  }
  try {
    const first = success(
      await evaluate(id(2), "box", {
        width: 2,
        depth: 3,
        height: 4,
        centered: false,
        origin: [0, 0, 0],
      }),
    )
    const second = success(
      await evaluate(id(3), "box", {
        width: 5,
        depth: 6,
        height: 7,
        centered: false,
        origin: [20, 0, 0],
      }),
    )
    const exported = await engine.exportDocument({
      documentId,
      features: [
        { featureId: id(2), contentHash: first.contentHash, outputRole: "result" },
        { featureId: id(3), contentHash: second.contentHash, outputRole: "result" },
      ],
      format: "step",
    })
    const bytes = Uint8Array.from(exported.file)
    const source = {
      format: "step" as const,
      digest: await digest(bytes),
      byteLength: bytes.byteLength,
      normalization: {
        sourceUnit: "millimeter" as const,
        scaleToMillimeters: 1,
        normalizedUnit: "millimeter" as const,
      },
      unitPolicy: "step-system-mm" as const,
      readerPolicyVersion: 1 as const,
    }
    const ownedBefore = engine.getHealth().ownedShapeCount
    const inspection = await engine.inspectSourceImport({
      source,
      bytes,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    })
    expect(inspection.outputs).toHaveLength(2)
    expect(inspection.outputs.every((output) => output.mesh.positions.length > 0)).toBe(true)
    expect(engine.getHealth().ownedShapeCount).toBe(ownedBefore)
    const outputs = inspection.outputs.map(({ signature }, index) => ({
      outputId: id(100 + index),
      signature,
    }))
    const asset = {
      id: id(50),
      digest: source.digest,
      byteLength: bytes.byteLength,
      filename: "Assembly.step",
      format: "step" as const,
      representation: "exact-solid" as const,
      normalization: source.normalization,
      outputs: outputs.map((output) => output.outputId),
    }
    const materialization = { asset, bytes }
    const parameters = { source, outputs, matchingPolicyVersion: 1 }
    const imported = success(await evaluate(id(4), "imported", parameters, materialization))
    expect(imported.result.bodies?.map((body) => body.outputRole)).toEqual(
      asset.outputs.map((outputId) => `import.${outputId}`),
    )
    expect(imported.result.shape.solidCount).toBe(2)
    expect(imported.result.shape.volume).toBeCloseTo(234, 5)
    expect(
      success(await evaluate(id(4), "imported", parameters, materialization)).result.cache.brepHit,
    ).toBe(true)
    expect(
      await evaluate(id(4), "imported", parameters, { asset, bytes: new Uint8Array(bytes.length) }),
    ).toMatchObject({ ok: false })
    expect(await evaluate(id(4), "imported", parameters)).toMatchObject({ ok: false })
    for (const format of ["step", "stl"] as const) {
      const all = await engine.exportDocument({
        documentId,
        features: asset.outputs.map((outputId) => ({
          featureId: id(4),
          contentHash: imported.contentHash,
          outputRole: `import.${outputId}`,
        })),
        format,
      })
      expect(all.bodyCount).toBe(2)
      if (format === "stl") expect(binaryStlVolume(all.file)).toBeCloseTo(234, 4)
      const selected = await engine.exportDocument({
        documentId,
        features: [
          {
            featureId: id(4),
            contentHash: imported.contentHash,
            outputRole: `import.${asset.outputs[0]}`,
          },
        ],
        format,
      })
      expect(selected.bodyCount).toBe(1)
      if (format === "stl")
        expect(binaryStlVolume(selected.file)).toBeCloseTo(outputs[0]?.signature.volume ?? 0, 4)
      expect(selected.file.byteLength).toBeGreaterThan(100)
    }
  } finally {
    engine.disposeDocument(documentId)
    expect(engine.getHealth().ownedShapeCount).toBe(0)
    vi.unstubAllGlobals()
  }
}, 60_000)
