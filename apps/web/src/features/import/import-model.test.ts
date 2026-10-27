import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { insertFeatureInHistoryCommandSchema } from "@vibeshape/domain"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { documentV4AssetsCommandSchema } from "@vibeshape/domain/document-v4-command-schemas"
import { readImportedFeatureParameters } from "@vibeshape/domain/part-design-import"
import { readMeshImportFeatureParameters } from "@vibeshape/domain/part-design-mesh-import"
import { vi } from "../../../../../tests/unit/support/bun-test"
import {
  createImportTransaction,
  type ImportFile,
  ImportFileError,
  type ImportSourceUnit,
  importSourceUnits,
  readImportSource,
} from "./import-model"
import { context, id, inspection, meshInspection, sourceFile } from "./import-test-fixtures"

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("A complete capture field is required.")
  return value
}

async function readExactSource(file: ImportFile, unit: ImportSourceUnit) {
  const prepared = await readImportSource(file, unit)
  if (prepared.representation !== "exact-solid") throw new Error("Expected an exact source.")
  return prepared
}

describe("captured exact source authoring", () => {
  it("retains default user provenance and accepts a validated trusted paired actor for every atomic command", async () => {
    let ordinal = 100
    const prepared = await readExactSource(sourceFile(), "millimeter")
    const actor = commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.import",
      sessionId: id(9),
    })
    const ordinary = createImportTransaction(context, prepared, inspection, "User source", () =>
      id(ordinal++),
    )
    expect(ordinary.commands.every((command) => command.actor.type === "user")).toBe(true)
    const paired = createImportTransaction(
      context,
      prepared,
      inspection,
      "Paired source",
      () => id(ordinal++),
      actor,
    )
    expect(paired.commands.map((command) => command.actor)).toEqual(
      Array(paired.commands.length).fill(actor),
    )
  })
  it("hides only the chosen source atomically while preserving the ordinary import command order", async () => {
    let ordinal = 100
    const prepared = await readExactSource(sourceFile(), "millimeter")
    const result = createImportTransaction(
      { ...context, authorityVersion: 4 },
      prepared,
      inspection,
      "Candidate",
      () => id(ordinal++),
      undefined,
      id(90),
    )
    expect(result.commands.map(({ kind }) => kind)).toEqual([
      "org.vibeshape.document.add-source-assets",
      "org.vibeshape.document.metadata-command",
      "org.vibeshape.history.insert-feature",
    ])
    expect(result.commands[1]).toMatchObject({
      payload: { kind: "part.set-visibility", partId: id(90), visible: false },
    })
    expect(result.commands.map(({ baseRevision }) => baseRevision)).toEqual([7, 8, 9])
    expect(result.assetBlobs).toHaveLength(1)
  })
  it.each(importSourceUnits.map((unit) => ({ unit })))(
    "hashes immutable bytes and records explicit %s metadata without a second STEP transform",
    async ({ unit }) => {
      const prepared = await readExactSource(sourceFile("original.STP"), unit)
      expect(prepared.source.digest).toBe(createHash("sha256").update(prepared.bytes).digest("hex"))
      expect(prepared.source).toMatchObject({
        format: "step",
        byteLength: 3,
        normalization: { sourceUnit: unit, normalizedUnit: "millimeter" },
        unitPolicy: "step-system-mm",
        readerPolicyVersion: 1,
      })
    },
  )
  it("records one-time BREP normalization from explicit inch metadata", async () => {
    expect((await readExactSource(sourceFile("original.brep"), "inch")).source).toMatchObject({
      format: "brep",
      normalization: { sourceUnit: "inch", scaleToMillimeters: 25.4 },
      unitPolicy: "brep-source-normalized",
    })
  })
  it.each([
    [sourceFile("source.obj"), "format"],
    [sourceFile("bad/name.step"), "filename"],
    [sourceFile("empty.step", new Uint8Array()), "budget"],
    [{ ...sourceFile(), size: Number.MAX_SAFE_INTEGER + 1 }, "budget"],
    [{ ...sourceFile(), size: 4 }, "budget"],
  ] as const)(
    "rejects unsupported or unsafe file metadata before inspection %j",
    async (file, code) => {
      await expect(readImportSource(file, "millimeter")).rejects.toMatchObject({ code })
    },
  )
  it("does not read unsupported formats, unsafe byte lengths or unsafe filenames", async () => {
    const read = vi.fn(async () => new ArrayBuffer(0))
    for (const file of [
      { name: "source.obj", size: 10 },
      { name: "source.step", size: Number.MAX_SAFE_INTEGER + 1 },
      { name: "../source.step", size: 10 },
    ])
      await expect(
        readImportSource({ ...file, arrayBuffer: read }, "millimeter"),
      ).rejects.toBeInstanceOf(ImportFileError)
    expect(read).not.toHaveBeenCalled()
  })
  it.each([2, 3, 4] as const)(
    "publishes complete capture on authority V%s through one atomic ordinary transaction",
    async (authorityVersion) => {
      const prepared = await readExactSource(sourceFile(), "millimeter")
      let ordinal = 100
      const second = required(inspection.outputs[0])
      const result = createImportTransaction(
        { ...context, authorityVersion },
        prepared,
        {
          ...inspection,
          outputs: [
            ...inspection.outputs,
            { ...second, signature: { ...second.signature, volume: 2000 } },
          ],
        },
        "Imported source",
        () => id(ordinal++),
      )
      expect(result.commands.map(({ kind }) => kind)).toEqual<unknown>([
        ...(authorityVersion === 2 ? ["org.vibeshape.document.upgrade-v3"] : []),
        ...(authorityVersion !== 4 ? ["org.vibeshape.document.upgrade-v4"] : []),
        "org.vibeshape.document.add-source-assets",
        "org.vibeshape.history.insert-feature",
      ])
      expect(result.commands.map(({ baseRevision }) => baseRevision)).toEqual(
        result.commands.map((_, index) => context.revision + index),
      )
      const assets = documentV4AssetsCommandSchema.parse(
        required(
          result.commands.find(({ kind }) => kind === "org.vibeshape.document.add-source-assets"),
        ),
      )
      const insert = insertFeatureInHistoryCommandSchema.parse(
        required(
          result.commands.find(({ kind }) => kind === "org.vibeshape.history.insert-feature"),
        ),
      )
      const parameters = required(readImportedFeatureParameters(insert.payload.feature))
      const asset = required(assets.payload.assets[0]),
        blob = required(result.assetBlobs[0])
      expect(parameters.sourceAssetId).toBe(asset.id)
      expect(parameters.outputs.map(({ outputId }) => outputId)).toEqual(asset.outputs)
      expect(new Set(parameters.outputs.map(({ outputId }) => outputId)).size).toBe(2)
      expect(parameters.outputs.map(({ signature }) => signature)).toEqual([
        second.signature,
        { ...second.signature, volume: 2000 },
      ])
      expect(insert.payload.feature.dependencies).toEqual([])
      expect(insert.payload.feature.references).toEqual([])
      expect(parameters).not.toHaveProperty("bytes")
      expect(parameters).not.toHaveProperty("mesh")
      expect(blob.bytes).toEqual(prepared.bytes)
      expect(blob.bytes).not.toBe(prepared.bytes)
      prepared.bytes.fill(0)
      expect(Array.from(blob.bytes)).toEqual([1, 2, 3])
    },
  )
  it("rejects an empty inspection or a false file-unit measurement claim before capture", async () => {
    const prepared = await readExactSource(sourceFile(), "millimeter")
    expect(() =>
      createImportTransaction(context, prepared, { ...inspection, outputs: [] }, "Import"),
    ).toThrow()
    expect(() =>
      createImportTransaction(
        context,
        prepared,
        { ...inspection, unitEvidence: "detected" } as unknown as typeof inspection,
        "Import",
      ),
    ).toThrow()
  })
})

describe("captured triangle-mesh source authoring", () => {
  it("prepares and captures local mesh source bytes above 32 MiB", async () => {
    const bytes = new Uint8Array(32 * 1024 * 1024 + 1)
    bytes[bytes.length - 1] = 41
    const prepared = await readImportSource(sourceFile("Candidate.stl", bytes), "millimeter")
    if (prepared.representation !== "triangle-mesh") throw new Error("Expected a mesh source.")
    expect(prepared.bytes.byteLength).toBe(33_554_433)
    expect(prepared.input.bytes.at(-1)).toBe(41)
    let ordinal = 100
    const transaction = createImportTransaction(
      context,
      prepared,
      meshInspection,
      "Candidate",
      () => id(ordinal++),
    )
    const command = transaction.commands.find(
      ({ kind }) => kind === "org.vibeshape.document.add-source-assets",
    )
    if (command?.kind !== "org.vibeshape.document.add-source-assets")
      throw new Error("Expected captured source assets.")
    expect(command.payload.assets[0]?.byteLength).toBe(33_554_433)
    expect(transaction.assetBlobs[0]?.bytes.at(-1)).toBe(41)
  })

  it.each(importSourceUnits.map((unit) => ({ unit })))(
    "requires and maps explicit STL %s units",
    async ({ unit }) => {
      const prepared = await readImportSource(sourceFile("original.STL"), unit)
      expect(prepared.representation).toBe("triangle-mesh")
      if (prepared.representation !== "triangle-mesh") throw new Error("Expected a mesh source.")
      expect(prepared.input.format).toBe("stl")
      expect(prepared.input.units).toBeDefined()
      expect(prepared.digest).toBe(createHash("sha256").update(prepared.bytes).digest("hex"))
      expect(prepared.input.bytes).not.toBe(prepared.bytes)
    },
  )
  it("forbids a 3MF unit override and rejects missing STL units before reading", async () => {
    const read = vi.fn(async () => new ArrayBuffer(3))
    await expect(
      readImportSource({ ...sourceFile("original.3mf"), arrayBuffer: read }, "inch"),
    ).rejects.toMatchObject({ code: "units" })
    await expect(
      readImportSource({ ...sourceFile("original.stl"), arrayBuffer: read }, null),
    ).rejects.toMatchObject({ code: "units" })
    expect(read).not.toHaveBeenCalled()
    const prepared = await readImportSource(sourceFile("original.3mf"), null)
    if (prepared.representation !== "triangle-mesh") throw new Error("Expected a mesh source.")
    expect(prepared.input).not.toHaveProperty("units")
  })
  it.each(["stl", "3mf"] as const)(
    "captures %s nodes as independent UUID outputs without exact signatures",
    async (format) => {
      const prepared = await readImportSource(
        sourceFile(`original.${format}`),
        format === "stl" ? "millimeter" : null,
      )
      let ordinal = 100
      const first = required(meshInspection.outputs[0])
      const inspected = {
        ...meshInspection,
        outputs: [first, { ...first, nodeKey: "second-build-node" }],
      }
      const result = createImportTransaction(context, prepared, inspected, "Mesh import", () =>
        id(ordinal++),
      )
      const assets = documentV4AssetsCommandSchema.parse(
        required(
          result.commands.find(({ kind }) => kind === "org.vibeshape.document.add-source-assets"),
        ),
      )
      const insert = insertFeatureInHistoryCommandSchema.parse(
        required(
          result.commands.find(({ kind }) => kind === "org.vibeshape.history.insert-feature"),
        ),
      )
      const parameters = required(readMeshImportFeatureParameters(insert.payload.feature))
      expect(parameters.outputs.map(({ nodeKey }) => nodeKey)).toEqual([
        first.nodeKey,
        "second-build-node",
      ])
      expect(new Set(parameters.outputs.map(({ outputId }) => outputId)).size).toBe(2)
      expect(assets.payload.assets[0]).toMatchObject({
        representation: "triangle-mesh",
        format,
        normalization: inspected.normalization,
        outputs: parameters.outputs.map(({ outputId }) => outputId),
      })
      expect(parameters.source.parserPolicyVersion).toBe(1)
      expect(parameters.outputs[0]).not.toHaveProperty("signature")
      expect(parameters).not.toHaveProperty("mesh")
      expect(result.assetBlobs[0]?.bytes).toEqual(prepared.bytes)
    },
  )
  it("rejects exact topology claims and repeated source nodes before publication", async () => {
    const prepared = await readImportSource(sourceFile("original.stl"), "millimeter")
    const first = required(meshInspection.outputs[0])
    expect(() =>
      createImportTransaction(
        context,
        prepared,
        { ...meshInspection, outputs: [first, first] },
        "Mesh",
      ),
    ).toThrow()
    expect(() =>
      createImportTransaction(
        context,
        prepared,
        {
          ...meshInspection,
          outputs: [{ ...first, shape: { ...first.shape, solidCount: 1, volume: 1 } }],
        },
        "Mesh",
      ),
    ).toThrow()
    expect(() =>
      createImportTransaction(
        context,
        prepared,
        {
          ...meshInspection,
          outputs: [{ ...first, shape: { ...first.shape, valid: false } }],
        },
        "Mesh",
      ),
    ).toThrow()
    expect(() => createImportTransaction(context, prepared, inspection, "Mesh")).toThrow()
  })
})
