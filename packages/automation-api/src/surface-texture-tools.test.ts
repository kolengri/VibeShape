import { describe, expect, it } from "bun:test"
import {
  surfaceTextureProjectFixture,
  textureFixtureId,
} from "../../../tests/fixtures/surface-texture-project"
import {
  localOperationSchema,
  localToolInputs,
  localToolNameSchema,
  localToolOutputs,
} from "./local-tools"
import { serializedQueryBytes } from "./query-byte-budget"
import { surfaceTextureResultContextMatches } from "./surface-texture-result-context"
import {
  decodeSurfaceTextureMap,
  packedSurfaceTextureMapSchema,
  surfaceTextureToolNames,
} from "./surface-texture-tools"
import { localToolAnnotations } from "./tool-metadata"

const fixture = surfaceTextureProjectFixture()
const { id: _id, featureId: _featureId, ...recipe } = fixture.layer
const create = (map = recipe.map) => ({
  tool: "create_surface_texture",
  arguments: {
    baseRevision: fixture.snapshot.revision,
    layerId: fixture.layer.id,
    featureId: fixture.layer.featureId,
    recipe: { ...recipe, map },
  },
})
const preview = { bodyCount: 1, sourceTriangleCount: 12, triangleCount: 48, vertexCount: 26 }

describe("named surface texture contracts", () => {
  it("publishes the same four strict names and annotations to both transports", () => {
    for (const name of surfaceTextureToolNames) {
      expect(localToolNameSchema.options).toContain(name)
      expect(localToolInputs[name]).toBeDefined()
      expect(localToolOutputs[name]).toBeDefined()
    }
    expect(localToolAnnotations("model_surface_textures")).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    })
    expect(localToolAnnotations("remove_surface_texture")).toMatchObject({
      destructiveHint: true,
      readOnlyHint: false,
    })
    expect(localOperationSchema.safeParse({ ...create(), approved: true }).success).toBe(false)
    expect(
      localToolInputs.remove_surface_texture.safeParse({
        baseRevision: 3,
        layerId: fixture.layer.id,
        authority: fixture.snapshot,
      }).success,
    ).toBe(false)
  })

  it("decodes a complete UI-sized custom map losslessly within the ordinary operation budget", () => {
    const pixels = Array.from({ length: 256 ** 2 }, () => 255)
    const map = {
      kind: "custom" as const,
      width: 256,
      height: 256,
      grayscaleBase64: `${"/".repeat(87380)}/w==`,
    }
    const operation = localOperationSchema.parse({
      ...create(),
      arguments: { ...create().arguments, recipe: { ...recipe, map } },
    })
    expect(serializedQueryBytes(operation)).toBeLessThan(192 * 1024)
    const decoded = decodeSurfaceTextureMap(map)
    expect(decoded.kind).toBe("custom")
    if (decoded.kind === "custom") expect(decoded.pixels).toEqual(pixels)
    expect(map.grayscaleBase64.length).toBe(87384)
    expect(
      decodeSurfaceTextureMap({ kind: "custom", width: 5, height: 1, grayscaleBase64: "AAGAf/8=" }),
    ).toMatchObject({ pixels: [0, 1, 128, 127, 255] })
  })

  it("rejects noncanonical pad bits, wrong lengths, uploads and unnormalized brush normals", () => {
    for (const grayscaleBase64 of ["AR==", "AQJ=", "AQ", "AQ==\n", "AQI="])
      expect(
        packedSurfaceTextureMapSchema.safeParse({
          kind: "custom",
          width: 1,
          height: 1,
          grayscaleBase64,
        }).success,
      ).toBe(false)
    expect(
      packedSurfaceTextureMapSchema.safeParse({
        kind: "custom",
        width: 1,
        height: 1,
        grayscaleBase64: "AQ==",
        url: "file:///image.png",
      }).success,
    ).toBe(false)
    expect(
      localToolInputs.update_surface_texture.safeParse({
        baseRevision: 3,
        layerId: fixture.layer.id,
        patch: {},
      }).success,
    ).toBe(false)
    const stroke = {
      center: [0, 0, 0],
      normal: [0, 0, 2],
      radiusMm: 1,
      hardness: 0.5,
      mode: "paint",
    }
    expect(
      localToolInputs.update_surface_texture.safeParse({
        baseRevision: 3,
        layerId: fixture.layer.id,
        appendMaskStrokes: [stroke],
      }).success,
    ).toBe(false)
    expect(
      localToolInputs.update_surface_texture.safeParse({
        baseRevision: 3,
        layerId: fixture.layer.id,
        patch: { mask: { base: "all", strokes: [] } },
        appendMaskStrokes: [],
      }).success,
    ).toBe(false)
  })

  it("binds read and commit receipts to the exact revision, feature, layer and operation", () => {
    const read = {
      tool: "model_surface_textures",
      arguments: { revision: 3, featureId: fixture.layer.featureId },
    }
    const value = {
      schemaVersion: 1,
      documentId: fixture.snapshot.id,
      revision: 3,
      featureId: fixture.layer.featureId,
      layers: [],
    }
    expect(surfaceTextureResultContextMatches(read, { ok: true, value }, fixture.snapshot.id)).toBe(
      true,
    )
    for (const patch of [
      { revision: 4 },
      { featureId: textureFixtureId(999) },
      { documentId: textureFixtureId(998) },
    ])
      expect(
        surfaceTextureResultContextMatches(
          read,
          { ok: true, value: { ...value, ...patch } },
          fixture.snapshot.id,
        ),
      ).toBe(false)
    const committed = {
      schemaVersion: 1,
      documentId: fixture.snapshot.id,
      baseRevision: 3,
      revision: 4,
      featureId: fixture.layer.featureId,
      layerId: fixture.layer.id,
      operation: "create",
      preview,
    }
    expect(
      surfaceTextureResultContextMatches(
        create(),
        { ok: true, value: committed },
        fixture.snapshot.id,
      ),
    ).toBe(true)
    for (const patch of [
      { layerId: textureFixtureId(999) },
      { operation: "remove" },
      { featureId: textureFixtureId(998) },
    ])
      expect(
        surfaceTextureResultContextMatches(
          create(),
          { ok: true, value: { ...committed, ...patch } },
          fixture.snapshot.id,
        ),
      ).toBe(false)
  })
})
