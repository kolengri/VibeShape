import { describe, expect, it } from "bun:test"
import {
  importedFeatureContentParametersSchema,
  importedSourceMaterializationSchema,
  sourceAssetMaterializationSchema,
  sourceAssetMaterializationsSchema,
} from "./import-content"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const signature = {
  volume: 24,
  area: 52,
  centroid: [1, 1.5, 2],
  bounds: { min: [0, 0, 0], max: [2, 3, 4] },
  faceCount: 6,
  edgeCount: 24,
}
function fixture() {
  const source = {
    digest: "a".repeat(64),
    byteLength: 3,
    format: "step",
    normalization: { sourceUnit: "inch", scaleToMillimeters: 25.4, normalizedUnit: "millimeter" },
    unitPolicy: "step-system-mm",
    readerPolicyVersion: 1,
  }
  const content = { source, outputs: [{ outputId: id(2), signature }], matchingPolicyVersion: 1 }
  const asset = {
    id: id(1),
    digest: source.digest,
    byteLength: 3,
    filename: "Source.step",
    format: "step",
    representation: "exact-solid",
    normalization: source.normalization,
    outputs: [id(2)],
  }
  return { sourceAssetId: id(1), content, asset, bytes: new Uint8Array([1, 2, 3]) }
}

describe("exact source import wire contract", () => {
  it("accepts only matching exact source metadata and ordered captured output identities", () => {
    const input = fixture()
    expect(importedSourceMaterializationSchema.safeParse(input).success).toBe(true)
    const invalid = [
      { sourceAssetId: id(99) },
      { asset: { ...input.asset, digest: "b".repeat(64) } },
      { asset: { ...input.asset, format: "brep" } },
      { asset: { ...input.asset, filename: "../Source.step" } },
      { asset: { ...input.asset, representation: "triangle-mesh" } },
      {
        asset: {
          ...input.asset,
          normalization: { ...input.asset.normalization, scaleToMillimeters: 1 },
        },
      },
      { asset: { ...input.asset, outputs: [id(99)] } },
      { bytes: new Uint8Array(2) },
      {
        content: {
          ...input.content,
          source: { ...input.content.source, unitPolicy: "brep-source-normalized" },
        },
      },
      {
        content: {
          ...input.content,
          source: {
            ...input.content.source,
            normalization: { ...input.content.source.normalization, sourceUnit: "unitless" },
          },
        },
      },
      {
        content: { ...input.content, source: { ...input.content.source, readerPolicyVersion: 2 } },
      },
      {
        content: {
          ...input.content,
          outputs: [...input.content.outputs, ...input.content.outputs],
        },
      },
      { content: { ...input.content, matchingPolicyVersion: 2 } },
      { extraneous: true },
    ]
    for (const changed of invalid)
      expect(importedSourceMaterializationSchema.safeParse({ ...input, ...changed }).success).toBe(
        false,
      )
  })

  it("accepts safe topology counts above former geometry admission limits", () => {
    const content = fixture().content
    expect(
      importedFeatureContentParametersSchema.safeParse({
        ...content,
        outputs: [
          {
            outputId: id(2),
            signature: { ...signature, faceCount: 500_001, edgeCount: 1_000_002 },
          },
        ],
      }).success,
    ).toBe(true)
  })

  it("materializes exact source bytes above the former local byte ceiling", () => {
    const input = fixture()
    const bytes = new Uint8Array(32 * 1024 * 1024 + 1)
    const source = { ...input.content.source, byteLength: bytes.byteLength }
    const asset = { ...input.asset, byteLength: bytes.byteLength }
    expect(
      importedSourceMaterializationSchema.safeParse({
        ...input,
        content: { ...input.content, source },
        asset,
        bytes,
      }).success,
    ).toBe(true)
  })

  it("rejects hostile metrics and unsupported policies before materialization", () => {
    const content = fixture().content
    for (const changed of [
      { volume: 0 },
      { area: Number.NaN },
      { faceCount: 0 },
      { edgeCount: Number.MAX_SAFE_INTEGER + 1 },
      { centroid: [Number.POSITIVE_INFINITY, 0, 0] },
      { bounds: { min: [0, 0, 0], max: [0, 1, 1] } },
      { bounds: { min: [0, 0, 0], max: [100_001, 1, 1] } },
    ])
      expect(
        importedFeatureContentParametersSchema.safeParse({
          ...content,
          outputs: [{ outputId: id(2), signature: { ...signature, ...changed } }],
        }).success,
      ).toBe(false)
    expect(
      importedFeatureContentParametersSchema.safeParse({ ...content, outputs: [] }).success,
    ).toBe(false)
    expect(
      importedFeatureContentParametersSchema.safeParse({
        ...content,
        source: { ...content.source, byteLength: Number.MAX_SAFE_INTEGER + 1 },
      }).success,
    ).toBe(false)
    expect(importedFeatureContentParametersSchema.safeParse(null).success).toBe(false)
  })
})

describe("transferable source asset materializations", () => {
  it("copies bytes after validating the complete neutral descriptor", () => {
    const input = fixture()
    const parsed = sourceAssetMaterializationSchema.parse({
      asset: input.asset,
      bytes: input.bytes,
    })
    input.bytes.fill(0)
    expect([...parsed.bytes]).toEqual([1, 2, 3])
    const mesh = {
      ...input.asset,
      filename: "Mesh.3mf",
      format: "3mf",
      representation: "triangle-mesh",
    }
    expect(
      sourceAssetMaterializationSchema.safeParse({ asset: mesh, bytes: parsed.bytes }).success,
    ).toBe(true)
    expect(
      sourceAssetMaterializationSchema.safeParse({
        asset: { ...mesh, representation: "exact-solid" },
        bytes: parsed.bytes,
      }).success,
    ).toBe(false)
    expect(
      sourceAssetMaterializationSchema.safeParse({ asset: input.asset, bytes: [1, 2, 3] }).success,
    ).toBe(false)
  })

  it("allows identical digest reuse and rejects conflicting bytes, repeated assets and catalog overflow", () => {
    const input = fixture()
    const first = { asset: input.asset, bytes: input.bytes }
    const second = { ...first, asset: { ...first.asset, id: id(3), outputs: [id(4)] } }
    const parsed = sourceAssetMaterializationsSchema.parse([first, second])
    expect(parsed[0]?.bytes).not.toBe(first.bytes)
    expect(parsed[1]?.bytes).not.toBe(second.bytes)
    expect(
      sourceAssetMaterializationsSchema.safeParse([
        first,
        { ...second, bytes: new Uint8Array([4, 5, 6]) },
      ]).success,
    ).toBe(false)
    expect(sourceAssetMaterializationsSchema.safeParse([first, first]).success).toBe(false)
    expect(
      sourceAssetMaterializationsSchema.safeParse(Array.from({ length: 129 }, () => first)).success,
    ).toBe(false)
    expect(
      sourceAssetMaterializationSchema.safeParse({ ...first, bytes: new Uint8Array(4) }).success,
    ).toBe(false)
  })
  it("materializes sources above 32 MiB and aggregate bytes above 64 MiB", () => {
    const bytes = new Uint8Array(32 * 1024 * 1024 + 1)
    bytes[bytes.length - 1] = 17
    const asset = {
      ...fixture().asset,
      format: "stl",
      filename: "Result.stl",
      representation: "triangle-mesh",
      byteLength: bytes.length,
    }
    const values = sourceAssetMaterializationsSchema.parse([
      { asset, bytes },
      { asset: { ...asset, id: id(3), outputs: [id(4)] }, bytes },
    ])
    expect(values).toHaveLength(2)
    for (const value of values) {
      expect(value.bytes).not.toBe(bytes)
      expect(value.bytes.length).toBe(33_554_433)
      expect(value.bytes.at(-1)).toBe(17)
    }
    for (const byteLength of [Infinity, Number.MAX_SAFE_INTEGER + 1, -1, 1.5])
      expect(
        sourceAssetMaterializationSchema.safeParse({ asset: { ...asset, byteLength }, bytes })
          .success,
      ).toBe(false)
  })
})
