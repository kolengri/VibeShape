import { applyDocumentCommand, type DocumentEvent } from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { readVShape, VSHAPE_MEDIA_TYPE, writeVShape } from "./vshape"

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ac"
const widthVariableId = "0195b5ac-b220-7a2c-8c33-67a36a7f21bc"
const wallVariableId = "0195b5ac-b220-7a2c-8c33-67a36a7f21bd"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f21be"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f21bf"
const sketchPointAId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c0"
const sketchPointBId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c1"
const sketchLineId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c2"
const sketchConstraintId = "0195b5ac-b220-7a2c-8c33-67a36a7f21c3"
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
  return { snapshot: feature.snapshot, events }
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
        manifest: { documentRevision: 4, units: "millimeter" },
        snapshot: {
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
