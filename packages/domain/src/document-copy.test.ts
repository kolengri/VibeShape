import { describe, expect, it } from "vitest"
import { applyDocumentCommand, replayDocumentEvents } from "./commands"
import { copyDocumentHistory } from "./document-copy"
import { boxFeatureType } from "./part-design"
import { createLengthQuantity } from "./units"

const sourceDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f5101"
const copiedDocumentId = "0195b5ac-b220-7a2c-8c33-67a36a7f5102"
const sourceCommandIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f5111",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5112",
] as const
const copiedCommandIds = [
  "0195b5ac-b220-7a2c-8c33-67a36a7f5121",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5122",
  "0195b5ac-b220-7a2c-8c33-67a36a7f5123",
] as const

function configurableDocument() {
  const created = applyDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: sourceCommandIds[0],
    documentId: sourceDocumentId,
    baseRevision: 0,
    issuedAt: "2026-08-08T00:00:00Z",
    actor: { type: "user", userId: null },
    payload: { name: "Bracket" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const variableAdded = applyDocumentCommand(created.snapshot, {
    kind: "org.vibeshape.variable.add",
    schemaVersion: 1,
    commandId: sourceCommandIds[1],
    documentId: sourceDocumentId,
    baseRevision: 1,
    issuedAt: "2026-08-08T00:01:00Z",
    actor: { type: "user", userId: null },
    payload: {
      variable: {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f5131",
        name: "width",
        expression: "24 mm",
      },
    },
  })
  if (!variableAdded.ok) throw new Error(variableAdded.diagnostic.message)
  return { snapshot: variableAdded.snapshot, events: [created.event, variableAdded.event] }
}

describe("copyDocumentHistory", () => {
  it("copies and replays preserved repair intent under new command identities", () => {
    const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f5201"
    const repairSourceCommandIds = [
      "0195b5ac-b220-7a2c-8c33-67a36a7f5211",
      "0195b5ac-b220-7a2c-8c33-67a36a7f5212",
      "0195b5ac-b220-7a2c-8c33-67a36a7f5213",
      "0195b5ac-b220-7a2c-8c33-67a36a7f5214",
    ] as const
    const repairCopyCommandIds = [
      "0195b5ac-b220-7a2c-8c33-67a36a7f5221",
      "0195b5ac-b220-7a2c-8c33-67a36a7f5222",
      "0195b5ac-b220-7a2c-8c33-67a36a7f5223",
      "0195b5ac-b220-7a2c-8c33-67a36a7f5224",
      "0195b5ac-b220-7a2c-8c33-67a36a7f5225",
    ] as const
    const created = applyDocumentCommand(null, {
      kind: "org.vibeshape.document.create",
      schemaVersion: 1,
      commandId: repairSourceCommandIds[0],
      documentId: sourceDocumentId,
      baseRevision: 0,
      issuedAt: "2026-08-08T00:00:00Z",
      actor: { type: "user", userId: null },
      payload: { name: "Repairable bracket" },
    })
    if (!created.ok) throw new Error(created.diagnostic.message)
    const featureAdded = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: repairSourceCommandIds[1],
      documentId: sourceDocumentId,
      baseRevision: created.snapshot.revision,
      issuedAt: "2026-08-08T00:01:00Z",
      actor: { type: "user", userId: null },
      payload: {
        feature: {
          schemaVersion: 0,
          id: featureId,
          type: boxFeatureType.type,
          parameters: {
            width: createLengthQuantity(20),
            depth: createLengthQuantity(20),
            height: createLengthQuantity(20),
            centered: false,
          },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    })
    if (!featureAdded.ok) throw new Error(featureAdded.diagnostic.message)
    const sketchAdded = applyDocumentCommand(featureAdded.snapshot, {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: repairSourceCommandIds[2],
      documentId: sourceDocumentId,
      baseRevision: featureAdded.snapshot.revision,
      issuedAt: "2026-08-08T00:02:00Z",
      actor: { type: "user", userId: null },
      payload: {
        sketch: {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f5231",
          label: "Referenced profile",
          plane: "xy",
          entities: [],
          constraints: [],
          externalReferences: [
            {
              schemaVersion: 0,
              id: "0195b5ac-b220-7a2c-8c33-67a36a7f5232",
              kind: "model-point",
              reference: {
                schemaVersion: 0,
                featureId,
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
              projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f5233",
            },
          ],
        },
      },
    })
    if (!sketchAdded.ok) throw new Error(sketchAdded.diagnostic.message)
    const removed = applyDocumentCommand(sketchAdded.snapshot, {
      kind: "org.vibeshape.feature.remove-preserving-model-reference-intent",
      schemaVersion: 1,
      commandId: repairSourceCommandIds[3],
      documentId: sourceDocumentId,
      baseRevision: sketchAdded.snapshot.revision,
      issuedAt: "2026-08-08T00:03:00Z",
      actor: { type: "user", userId: null },
      payload: { featureId },
    })
    if (!removed.ok) throw new Error(removed.diagnostic.message)

    const copied = copyDocumentHistory({
      sourceSnapshot: removed.snapshot,
      sourceEvents: [created.event, featureAdded.event, sketchAdded.event, removed.event],
      documentId: copiedDocumentId,
      commandIds: repairCopyCommandIds,
      name: "Repairable bracket copy",
      issuedAt: "2026-08-08T00:04:00Z",
      actor: { type: "user", userId: null },
    })

    expect(copied).toMatchObject({
      ok: true,
      snapshot: {
        id: copiedDocumentId,
        revision: 5,
        features: [],
        sketches: [
          {
            externalReferences: [
              {
                schemaVersion: 1,
                orphanedSource: { kind: "deleted-feature", featureId },
              },
            ],
          },
        ],
      },
    })
    if (!copied.ok) return
    expect(replayDocumentEvents(copied.events)).toEqual({ ok: true, snapshot: copied.snapshot })
  })

  it("preserves semantic history under new document and command identities", () => {
    const source = configurableDocument()
    const copied = copyDocumentHistory({
      sourceSnapshot: source.snapshot,
      sourceEvents: source.events,
      documentId: copiedDocumentId,
      commandIds: copiedCommandIds,
      name: "Bracket copy",
      issuedAt: "2026-08-08T00:02:00Z",
      actor: { type: "user", userId: null },
    })

    expect(copied).toMatchObject({
      ok: true,
      snapshot: {
        id: copiedDocumentId,
        name: "Bracket copy",
        revision: 3,
        variables: [{ id: source.snapshot.variables[0]?.id, name: "width" }],
      },
    })
    if (!copied.ok) return
    expect(copied.events.map((event) => event.documentId)).toEqual([
      copiedDocumentId,
      copiedDocumentId,
      copiedDocumentId,
    ])
    expect(copied.events.map((event) => event.commandId)).toEqual(copiedCommandIds)
    expect(replayDocumentEvents(copied.events)).toEqual({ ok: true, snapshot: copied.snapshot })
    expect(source.snapshot).toMatchObject({ id: sourceDocumentId, name: "Bracket", revision: 2 })
  })

  it("rejects source command identity reuse", () => {
    const source = configurableDocument()
    expect(
      copyDocumentHistory({
        sourceSnapshot: source.snapshot,
        sourceEvents: source.events,
        documentId: copiedDocumentId,
        commandIds: [...sourceCommandIds, copiedCommandIds[2]],
        name: "Bracket copy",
        issuedAt: "2026-08-08T00:02:00Z",
        actor: { type: "user", userId: null },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })
})
