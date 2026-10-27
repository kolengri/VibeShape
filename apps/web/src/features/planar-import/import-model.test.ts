import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { insertSketchInHistoryCommandSchema } from "@vibeshape/domain"
import { documentSnapshotV3Schema } from "@vibeshape/domain/document-v3"
import { documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import { documentV4AssetsCommandSchema } from "@vibeshape/domain/document-v4-command-schemas"
import { prepareAuthorityTransaction } from "../../../../../packages/application/src/authority-transaction"
import { surfaceTextureProjectFixture } from "../../../../../tests/fixtures/surface-texture-project"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { authoredTreeFixture } from "../../test-support/authored-tree-fixture"
import { createPlanarImportTransaction, PlanarFileError, readPlanarSource } from "./import-model"
import { inspectPlanarRequest } from "./parser-service"

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 2 3 L 22 3 L 22 13 L 2 13 Z"/></svg>'
const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
function file(text = svg, name = "outline.svg") {
  const bytes = new TextEncoder().encode(text)
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer }
}
const dxf = (header = "9\n$INSUNITS\n70\n1\n") =>
  `0\nSECTION\n2\nHEADER\n${header}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nCUT\n10\n1\n20\n2\n40\n1\n0\nENDSEC\n0\nEOF\n`

async function preparedSource() {
  const source = await readPlanarSource(file(), "mm")
  const inspection = await inspectPlanarRequest({ schemaVersion: 0, input: source.input })
  if (!inspection.ok) throw new Error(inspection.diagnostic.message)
  return { source, inspection }
}

describe("planar import worker and authored transaction", () => {
  it("normalizes exact SVG curves in the readonly worker pipeline and hashes retained source bytes", async () => {
    const source = await readPlanarSource(file(), "px")
    expect(source.digest).toBe(createHash("sha256").update(source.bytes).digest("hex"))
    const inspected = await inspectPlanarRequest({ schemaVersion: 0, input: source.input })
    expect(inspected.ok).toBe(true)
    if (!inspected.ok) throw new Error(inspected.diagnostic.message)
    expect(inspected.prepared.paths[0]?.closed).toBe(true)
    expect(inspected.prepared.paths[0]?.segments).toHaveLength(4)
    expect(inspected.bounds.min[0]).toBeCloseTo((2 * 25.4) / 96)
    expect(inspected.bounds.min[1]).toBeCloseTo((3 * 25.4) / 96)
    expect(inspected.bounds.max[0]).toBeCloseTo((22 * 25.4) / 96)
  })
  it("uses declared DXF units or an explicit override and fails for unitless declared input", async () => {
    const source = await readPlanarSource(file(dxf(), "circle.dxf"), "declared")
    const result = await inspectPlanarRequest({ schemaVersion: 0, input: source.input })
    expect(result).toMatchObject({
      ok: true,
      prepared: { units: { sourceUnit: "in", policy: "declared", millimetersPerUnit: 25.4 } },
    })
    const override = await readPlanarSource(file(dxf(""), "circle.dxf"), "mm")
    expect(await inspectPlanarRequest({ schemaVersion: 0, input: override.input })).toMatchObject({
      ok: true,
      prepared: { units: { sourceUnit: "mm", policy: "selected" } },
    })
    const unitless = await readPlanarSource(file(dxf(""), "circle.dxf"), "declared")
    expect(await inspectPlanarRequest({ schemaVersion: 0, input: unitless.input })).toMatchObject({
      ok: false,
      diagnostic: { code: "units-required" },
    })
  })
  it("fails before reading unsafe metadata and returns complete unsupported source diagnostics", async () => {
    const read = vi.fn(async () => new ArrayBuffer(0))
    for (const metadata of [
      { name: "../outline.svg", size: 1 },
      { name: "outline.stl", size: 1 },
      { name: "outline.svg", size: Number.NaN },
      { name: "outline.svg", size: Number.POSITIVE_INFINITY },
      { name: "outline.svg", size: 0 },
      { name: "outline.svg", size: 1.5 },
      { name: "outline.svg", size: 32 * 1024 * 1024 + 1 },
    ])
      await expect(
        readPlanarSource({ ...metadata, arrayBuffer: read }, "mm"),
      ).rejects.toBeInstanceOf(PlanarFileError)
    expect(read).not.toHaveBeenCalled()
    const source = await readPlanarSource(
      file('<svg xmlns="http://www.w3.org/2000/svg"><text>Unsupported text</text></svg>'),
      "mm",
    )
    const unsupported = await inspectPlanarRequest({ schemaVersion: 0, input: source.input })
    expect(unsupported).toMatchObject({ ok: false, diagnostic: { code: "unsupported-geometry" } })
    if (!unsupported.ok) expect(unsupported.diagnostic.source).toBe("text")
    expect(
      await inspectPlanarRequest({
        schemaVersion: 0,
        input: { format: "svg", bytes: new Uint8Array(0), units: "mm" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-input" } })
  })
  it.each([2, 3, 4] as const)(
    "captures source and ordinary sketch in one V%s transaction without Part creation",
    async (authorityVersion) => {
      const { source, inspection } = await preparedSource()
      let next = 100
      const result = createPlanarImportTransaction(
        { documentId: id(1), revision: 10, authorityVersion, historyAfter: null },
        source,
        inspection,
        "xz",
        "Imported outline.svg",
        () => id(next++),
      )
      expect(
        result.commands.every(
          (command) => command.actor.type === "user" && command.actor.userId === null,
        ),
      ).toBe(true)
      expect(result.commands.map(({ kind }) => kind)).toEqual<unknown>([
        ...(authorityVersion === 2 ? ["org.vibeshape.document.upgrade-v3"] : []),
        ...(authorityVersion !== 4 ? ["org.vibeshape.document.upgrade-v4"] : []),
        "org.vibeshape.document.add-source-assets",
        "org.vibeshape.history.insert-sketch",
      ])
      expect(result.commands.map(({ baseRevision }) => baseRevision)).toEqual(
        result.commands.map((_, index) => 10 + index),
      )
      const added = documentV4AssetsCommandSchema.parse(
        result.commands.find(({ kind }) => kind === "org.vibeshape.document.add-source-assets"),
      )
      const command = insertSketchInHistoryCommandSchema.parse(result.commands.at(-1))
      if (command.kind !== "org.vibeshape.history.insert-sketch")
        throw new Error("Expected ordinary sketch command.")
      expect(command.payload.sketch.plane).toBe("xz")
      expect(command.payload.sketch.entities.filter(({ type }) => type === "line")).toHaveLength(4)
      expect(command.payload.sketch.entities.filter(({ type }) => type === "point")).toHaveLength(4)
      expect(command.payload.sketch.sourceImport).toMatchObject({
        assetId: added.payload.assets[0]?.id,
        paths: [{ outputId: added.payload.assets[0]?.outputs[0] }],
      })
      expect(command.payload.sketch.sourceImport).not.toHaveProperty("bytes")
      expect(result.assetBlobs[0]?.bytes).not.toBe(source.bytes)
      const original = Array.from(source.bytes)
      source.bytes.fill(0)
      expect(Array.from(result.assetBlobs[0]?.bytes ?? [])).toEqual(original)
    },
  )
  it.each([2, 3, 4] as const)(
    "commits an anchored ordinary sketch through the real V%s authored authority port",
    async (authorityVersion) => {
      const { source, inspection } = await preparedSource()
      let next = 100
      const v2 = authoredTreeFixture().authority
      const base =
        authorityVersion === 2
          ? v2
          : authorityVersion === 3
            ? documentSnapshotV3Schema.parse({ ...v2, schemaVersion: 3, surfaceTextures: [] })
            : documentSnapshotV4Schema.parse({
                ...v2,
                schemaVersion: 4,
                surfaceTextures: [],
                assets: [],
              })
      const actual = createPlanarImportTransaction(
        {
          documentId: base.id,
          revision: base.revision,
          authorityVersion,
          historyAfter: base.history.at(-1) ?? null,
        },
        source,
        inspection,
        "xz",
        "Imported outline.svg",
        () => id(next++),
      )
      const allocatePart = vi.fn(() => {
        throw new Error("Sketch import must not allocate a Part.")
      })
      const committed = prepareAuthorityTransaction(base, actual, allocatePart)
      expect(committed.ok).toBe(true)
      if (!committed.ok) throw new Error(committed.diagnostic.message)
      expect(committed.snapshot.sketches.at(-1)?.sourceImport?.digest).toBe(source.digest)
      expect(committed.snapshot.parts).toEqual(base.parts)
      expect(committed.snapshot.schemaVersion).toBe(4)
      expect("surfaceTextures" in committed.snapshot && committed.snapshot.surfaceTextures).toEqual(
        [],
      )
      expect(
        committed.events.every(({ transactionId }) => transactionId === actual.transactionId),
      ).toBe(true)
      expect(allocatePart).not.toHaveBeenCalled()
    },
  )
  it("preserves published V3 texture authority when upgrading and importing a sketch", async () => {
    const textured = surfaceTextureProjectFixture()
    const base = documentSnapshotV3Schema.parse({
      ...textured.snapshot,
      schemaVersion: 3,
      surfaceTextures: [textured.layer],
    })
    const before = structuredClone(base)
    const { source, inspection } = await preparedSource()
    let next = 500
    const transaction = createPlanarImportTransaction(
      {
        documentId: base.id,
        revision: base.revision,
        authorityVersion: 3,
        historyAfter: base.history.at(-1) ?? null,
      },
      source,
      inspection,
      "xy",
      "Outline",
      () => id(next++),
    )
    const committed = prepareAuthorityTransaction(base, transaction, () => {
      throw new Error("Sketch import must not allocate a Part.")
    })
    expect(committed.ok).toBe(true)
    if (!committed.ok) throw new Error(committed.diagnostic.message)
    expect(committed.snapshot.schemaVersion).toBe(4)
    expect("surfaceTextures" in committed.snapshot && committed.snapshot.surfaceTextures).toEqual([
      textured.layer,
    ])
    expect(committed.snapshot.features).toEqual(base.features)
    expect(committed.snapshot.parts).toEqual(base.parts)
    expect(base).toEqual(before)
  })
})
