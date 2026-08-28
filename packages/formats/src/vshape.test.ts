import { applyDocumentCommand, type DocumentEvent } from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { migrateDocumentSnapshot } from "@vibeshape/domain/document-migration"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { describe, expect, it } from "vitest"
import {
  readVersionedVShape,
  readVShape,
  readVShapeV1,
  VSHAPE_MEDIA_TYPE,
  writeVShape,
  writeVShapeV1,
} from "./vshape"

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ac"
const widthVariableId = "0195b5ac-b220-7a2c-8c33-67a36a7f21bc"
const wallVariableId = "0195b5ac-b220-7a2c-8c33-67a36a7f21bd"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f21be"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f21bf"
const sketchPointAId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c0"
const sketchPointBId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c1"
const sketchLineId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c2"
const sketchConstraintId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c3"
const repairFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c4"
const repairSketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c5"
const repairReferenceId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c6"
const repairProjectedPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c7"
const timestamp = "2026-08-09T10:00:00Z"

function commandId(index: number) {
  return `0195b5ac-b220-7a2c-8c33-${(0x67a36a7f2200 + index).toString(16)}`
}

function apply(
  snapshot: DocumentSnapshot | null,
  command: Parameters<typeof applyDocumentCommand>[1],
) {
  const result = applyDocumentCommand(snapshot, command)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

function configurableProject() {
  const events: DocumentEvent[] = []
  const created = apply(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: commandId(1),
    documentId,
    baseRevision: 0,
    issuedAt: timestamp,
    actor: { type: "user", userId: null },
    payload: { name: "Configurable bracket" },
  })
  events.push(created.event)
  const variables = apply(created.snapshot, {
    kind: "org.vibeshape.variable.replace-table",
    schemaVersion: 1,
    commandId: commandId(2),
    documentId,
    baseRevision: 1,
    issuedAt: "2026-08-09T10:01:00Z",
    actor: { type: "user", userId: null },
    payload: {
      variables: [
        { schemaVersion: 0, id: wallVariableId, name: "wall", expression: "2 mm" },
        {
          schemaVersion: 0,
          id: widthVariableId,
          name: "width",
          expression: "10 * #wall",
        },
      ],
    },
  })
  events.push(variables.event)
  const sketch = apply(variables.snapshot, {
    kind: "org.vibeshape.sketch.add",
    schemaVersion: 1,
    commandId: commandId(3),
    documentId,
    baseRevision: 2,
    issuedAt: "2026-08-09T10:02:00Z",
    actor: { type: "user", userId: null },
    payload: {
      sketch: {
        schemaVersion: 0,
        id: sketchId,
        label: "Bracket profile",
        plane: "xy",
        entities: [
          {
            schemaVersion: 0,
            id: sketchPointAId,
            type: "point",
            x: 0,
            y: 0,
            construction: false,
          },
          {
            schemaVersion: 0,
            id: sketchPointBId,
            type: "point",
            x: 20,
            y: 0,
            construction: false,
          },
          {
            schemaVersion: 0,
            id: sketchLineId,
            type: "line",
            startPointId: sketchPointAId,
            endPointId: sketchPointBId,
            construction: false,
          },
        ],
        constraints: [
          {
            schemaVersion: 0,
            id: sketchConstraintId,
            type: "distance",
            firstPointId: sketchPointAId,
            secondPointId: sketchPointBId,
            value: createLengthQuantity(20, "mm", "#width"),
          },
        ],
      },
    },
  })
  events.push(sketch.event)
  const feature = apply(sketch.snapshot, {
    kind: "org.vibeshape.feature.add",
    schemaVersion: 1,
    commandId: commandId(4),
    documentId,
    baseRevision: 3,
    issuedAt: "2026-08-09T10:03:00Z",
    actor: { type: "user", userId: null },
    payload: {
      feature: {
        schemaVersion: 0,
        id: featureId,
        type: {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.box",
          schemaVersion: 1,
        },
        parameters: {
          width: {
            dimension: "length",
            value: 20,
            source: { value: 20, unit: "mm", expression: "#width" },
          },
          depth: {
            dimension: "length",
            value: 10,
            source: { value: 10, unit: "mm", expression: "10 mm" },
          },
          height: {
            dimension: "length",
            value: 4,
            source: { value: 4, unit: "mm", expression: "2 * #wall" },
          },
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed: false,
        label: "Bracket body",
      },
    },
  })
  events.push(feature.event)
  const displayUnits = apply(feature.snapshot, {
    kind: "org.vibeshape.document.set-display-units",
    schemaVersion: 1,
    commandId: commandId(5),
    documentId,
    baseRevision: 4,
    issuedAt: "2026-08-09T10:04:00Z",
    actor: { type: "user", userId: null },
    payload: { displayUnits: { length: "in", angle: "deg" } },
  })
  events.push(displayUnits.event)
  return { snapshot: displayUnits.snapshot, events }
}

function repairIntentProject() {
  const created = apply(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: commandId(21),
    documentId,
    baseRevision: 0,
    issuedAt: timestamp,
    actor: { type: "user", userId: null },
    payload: { name: "Repairable reference" },
  })
  const feature = apply(created.snapshot, {
    kind: "org.vibeshape.feature.add",
    schemaVersion: 1,
    commandId: commandId(22),
    documentId,
    baseRevision: 1,
    issuedAt: "2026-08-09T10:01:00Z",
    actor: { type: "user", userId: null },
    payload: {
      feature: {
        schemaVersion: 0,
        id: repairFeatureId,
        type: boxFeatureType.type,
        parameters: {
          width: createLengthQuantity(20),
          depth: createLengthQuantity(10),
          height: createLengthQuantity(4),
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed: false,
        label: "Disposable body",
      },
    },
  })
  const sketch = apply(feature.snapshot, {
    kind: "org.vibeshape.sketch.add",
    schemaVersion: 1,
    commandId: commandId(23),
    documentId,
    baseRevision: 2,
    issuedAt: "2026-08-09T10:02:00Z",
    actor: { type: "user", userId: null },
    payload: {
      sketch: {
        schemaVersion: 0,
        id: repairSketchId,
        label: "Repairable reference",
        plane: "xy",
        entities: [],
        constraints: [],
        externalReferences: [
          {
            schemaVersion: 0,
            id: repairReferenceId,
            kind: "model-point",
            reference: {
              schemaVersion: 0,
              featureId: repairFeatureId,
              kind: "vertex",
              signature: {
                kind: "vertex",
                geometryClass: "POINT",
                measure: 0,
                centroid: [0, 0, 0],
                bounds: { min: [0, 0, 0], max: [0, 0, 0] },
                boundaryCount: 0,
                adjacentGeometryClasses: [],
              },
            },
            projectedPointId: repairProjectedPointId,
          },
        ],
      },
    },
  })
  const removed = apply(sketch.snapshot, {
    kind: "org.vibeshape.feature.remove-preserving-model-reference-intent",
    schemaVersion: 1,
    commandId: commandId(24),
    documentId,
    baseRevision: 3,
    issuedAt: "2026-08-09T10:03:00Z",
    actor: { type: "user", userId: null },
    payload: { featureId: repairFeatureId },
  })
  return {
    snapshot: removed.snapshot,
    events: [created.event, feature.event, sketch.event, removed.event],
  }
}

const metadata = {
  exportedAt: "2026-08-09T10:03:00Z",
  createdBy: { application: "VibeShape", version: "0.0.0", build: "test" },
} as const

describe(".vshape v0", () => {
  it("writes deterministic archives and preserves configurable variable sources", async () => {
    const project = configurableProject()
    const first = await writeVShape({ ...project, ...metadata })
    const second = await writeVShape({ ...project, ...metadata })

    expect(VSHAPE_MEDIA_TYPE).toBe("application/vnd.vibeshape.project+zip")
    expect(first).toEqual(second)
    if (!first.ok) return
    const read = await readVShape(first.value)

    expect(read).toMatchObject({
      ok: true,
      value: {
        manifest: { documentRevision: 5, units: "millimeter" },
        snapshot: {
          displayUnits: { length: "in", angle: "deg" },
          variables: [
            { id: wallVariableId, name: "wall", expression: "2 mm" },
            { id: widthVariableId, name: "width", expression: "10 * #wall" },
          ],
          sketches: [
            {
              id: sketchId,
              constraints: [
                {
                  id: sketchConstraintId,
                  value: { source: { expression: "#width" } },
                },
              ],
            },
          ],
          features: [
            {
              id: featureId,
              parameters: {
                width: { source: { expression: "#width" } },
                height: { source: { expression: "2 * #wall" } },
              },
            },
          ],
        },
      },
    })
  })

  it("round-trips a preserve-intent removal journal and orphan marker", async () => {
    const written = await writeVShape({ ...repairIntentProject(), ...metadata })
    if (!written.ok) throw new Error(written.diagnostic.message)
    const read = await readVShape(written.value)
    if (!read.ok) throw new Error(read.diagnostic.message)

    expect(read.value.manifest.documentRevision).toBe(4)
    expect(read.value.events.at(-1)?.type).toBe(
      "org.vibeshape.feature.removed-preserving-model-reference-intent",
    )
    expect(read.value.snapshot.sketches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: repairSketchId,
          externalReferences: [
            expect.objectContaining({
              schemaVersion: 1,
              id: repairReferenceId,
              orphanedSource: { kind: "deleted-feature", featureId: repairFeatureId },
            }),
          ],
        }),
      ]),
    )
  })

  it("rejects a semantic entry whose bytes no longer match the manifest", async () => {
    const written = await writeVShape({ ...configurableProject(), ...metadata })
    if (!written.ok) return
    const files = unzipSync(written.value)
    files["document.json"] = strToU8("{}")

    await expect(readVShape(zipSync(files))).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "integrity-mismatch" },
    })
  })

  it("rejects undeclared entries and unsafe normalized paths before parsing", async () => {
    const written = await writeVShape({ ...configurableProject(), ...metadata })
    if (!written.ok) return
    const files = unzipSync(written.value)

    await expect(
      readVShape(zipSync({ ...files, "previews/thumbnail.png": new Uint8Array([1]) })),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "undeclared-entry" } })
    await expect(
      readVShape(zipSync({ ...files, "../document.json": new Uint8Array([1]) })),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "unsafe-path" } })
  })

  it("reports a future archive version before applying the strict v0 schema", async () => {
    const written = await writeVShape({ ...configurableProject(), ...metadata })
    if (!written.ok) return
    const files = unzipSync(written.value)
    const manifest = JSON.parse(strFromU8(files["manifest.json"] as Uint8Array))
    files["manifest.json"] = strToU8(
      JSON.stringify({ ...manifest, formatVersion: 1, minimumReaderVersion: 1 }),
    )

    await expect(readVShape(zipSync(files))).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "unsupported-version" },
    })
  })

  it("rejects a writer input whose journal does not reproduce its snapshot", async () => {
    const project = configurableProject()

    await expect(
      writeVShape({ ...project, events: project.events.slice(0, -1), ...metadata }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "history-mismatch" } })
  })

  it("allows an independent compatible writer and does not trust clock ordering", async () => {
    const written = await writeVShape({
      ...configurableProject(),
      exportedAt: "2026-08-09T09:00:00Z",
      createdBy: { application: "Independent VibeShape writer", version: "1.0.0", build: null },
    })
    if (!written.ok) throw new Error(written.diagnostic.message)

    await expect(readVShape(written.value)).resolves.toMatchObject({
      ok: true,
      value: {
        manifest: {
          exportedAt: "2026-08-09T09:00:00Z",
          createdBy: { application: "Independent VibeShape writer" },
        },
      },
    })
  })
})

describe(".vshape v1", () => {
  async function migratedProject() {
    const legacy = configurableProject()
    const migrated = migrateDocumentSnapshot(legacy.snapshot, legacy.events)
    if (!migrated.ok) throw new Error(migrated.diagnostic.message)
    return { ...legacy, snapshot: migrated.snapshot }
  }

  it("round-trips deterministic History and semanticInputs", async () => {
    const project = await migratedProject()
    const first = await writeVShapeV1({ ...project, ...metadata })
    const second = await writeVShapeV1({ ...project, ...metadata })
    expect(first).toEqual(second)
    if (!first.ok) throw new Error(first.diagnostic.message)
    await expect(readVShapeV1(first.value)).resolves.toMatchObject({
      ok: true,
      value: {
        manifest: { schemaVersion: 1, formatVersion: 1, minimumReaderVersion: 1 },
        snapshot: {
          schemaVersion: 1,
          history: [
            { kind: "sketch", id: sketchId },
            { kind: "feature", id: featureId },
          ],
          features: [{ semanticInputs: null }],
        },
      },
    })
  })

  it("migrates and round-trips preserve-intent removal history", async () => {
    const legacy = repairIntentProject()
    const migrated = migrateDocumentSnapshot(legacy.snapshot, legacy.events)
    if (!migrated.ok) throw new Error(migrated.diagnostic.message)
    const written = await writeVShapeV1({ ...legacy, snapshot: migrated.snapshot, ...metadata })
    if (!written.ok) throw new Error(written.diagnostic.message)
    const read = await readVShapeV1(written.value)
    if (!read.ok) throw new Error(read.diagnostic.message)

    expect(read.value.events.at(-1)?.type).toBe(
      "org.vibeshape.feature.removed-preserving-model-reference-intent",
    )
    expect(read.value.snapshot.history).not.toContainEqual({
      kind: "feature",
      id: repairFeatureId,
    })
    expect(read.value.snapshot.sketches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: repairSketchId,
          externalReferences: [
            expect.objectContaining({
              schemaVersion: 1,
              orphanedSource: { kind: "deleted-feature", featureId: repairFeatureId },
            }),
          ],
        }),
      ]),
    )
  })

  it("rejects wrong or tampered History even when entry checksums are recomputed", async () => {
    const project = await migratedProject()
    const wrongHistory = {
      ...project,
      snapshot: { ...project.snapshot, history: [...project.snapshot.history].reverse() },
    }
    await expect(writeVShapeV1({ ...wrongHistory, ...metadata })).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "history-mismatch" },
    })

    const written = await writeVShapeV1({ ...project, ...metadata })
    if (!written.ok) throw new Error(written.diagnostic.message)
    const files = unzipSync(written.value)
    const snapshot = JSON.parse(strFromU8(files["document.json"] as Uint8Array))
    snapshot.history = [...snapshot.history].reverse()
    files["document.json"] = strToU8(JSON.stringify(snapshot))
    const manifest = JSON.parse(strFromU8(files["manifest.json"] as Uint8Array))
    const digest = await (
      globalThis as typeof globalThis & {
        crypto: {
          subtle: { digest: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer> }
        }
      }
    ).crypto.subtle.digest("SHA-256", files["document.json"] as Uint8Array)
    manifest.semanticEntries[0].bytes = files["document.json"].byteLength
    manifest.semanticEntries[0].sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
    files["manifest.json"] = strToU8(JSON.stringify(manifest))
    await expect(readVShapeV1(zipSync(files))).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "history-mismatch" },
    })
  })

  it("dispatches versions and rejects v0 archives as v1", async () => {
    const legacy = await writeVShape({ ...configurableProject(), ...metadata })
    if (!legacy.ok) throw new Error(legacy.diagnostic.message)
    await expect(readVShapeV1(legacy.value)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-manifest" },
    })
    await expect(readVersionedVShape(legacy.value)).resolves.toMatchObject({
      ok: true,
      value: { version: 0 },
    })
    const current = await writeVShapeV1({ ...(await migratedProject()), ...metadata })
    if (!current.ok) throw new Error(current.diagnostic.message)
    await expect(readVShape(current.value)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "unsupported-version" },
    })
    await expect(readVersionedVShape(current.value)).resolves.toMatchObject({
      ok: true,
      value: { version: 1, project: { manifest: { formatVersion: 1 } } },
    })
  })
})
