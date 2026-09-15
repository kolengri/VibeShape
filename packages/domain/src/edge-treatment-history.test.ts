import { expect, it } from "vitest"
import type { DocumentSnapshotV1 } from "./document"
import { featureRecordSchema } from "./feature-graph"
import { boxFeatureType, chamferFeatureType, filletFeatureType } from "./part-design"
import { createLengthQuantity } from "./units"
import {
  applyVersionedDocumentCommand,
  projectDocumentSnapshotV1ToV0,
  replayVersionedDocumentEvents,
} from "./versioned-document-commands"

const uuid = (value: number) => `0195b5ac-b270-7a2c-8c33-${value.toString().padStart(12, "0")}`
const actor = { type: "user", userId: "org.vibeshape.user.edge-treatment-test" } as const

function requireSuccess<T extends { ok: true } | { ok: false; diagnostic: { message: string } }>(
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result as Extract<T, { ok: true }>
}

function requireLastFeature<Feature>(snapshot: { features: readonly Feature[] }) {
  const feature = snapshot.features.at(-1)
  if (!feature) throw new Error("Expected an edge treatment feature.")
  return feature
}

function envelope(kind: string, baseRevision: number, value: number) {
  return {
    kind,
    schemaVersion: 1,
    commandId: uuid(value),
    documentId: uuid(1),
    baseRevision,
    issuedAt: "2026-09-01T08:00:00.000Z",
    actor,
  }
}

function createDocument() {
  const result = applyVersionedDocumentCommand(null, {
    ...envelope("org.vibeshape.document.create", 0, 2),
    payload: { name: "Edge treatment history" },
  })
  expect(result).toMatchObject({ ok: true })
  return requireSuccess(result)
}

function box() {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: uuid(10),
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(15),
      height: createLengthQuantity(10),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
    label: "Box 1",
  })
}

function treatment(kind: "fillet" | "chamfer", expression: string) {
  const target = box()
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: uuid(kind === "fillet" ? 20 : 30),
    type: kind === "fillet" ? filletFeatureType.type : chamferFeatureType.type,
    parameters:
      kind === "fillet"
        ? { radius: createLengthQuantity(2, "mm", expression) }
        : { distance: createLengthQuantity(2, "mm", expression) },
    dependencies: [target.id],
    references: [],
    suppressed: false,
    label: `${kind} 1`,
  })
}

function insert(
  snapshot: DocumentSnapshotV1,
  feature: ReturnType<typeof box> | ReturnType<typeof treatment>,
) {
  const result = applyVersionedDocumentCommand(snapshot, {
    ...envelope("org.vibeshape.history.insert-feature", snapshot.revision, snapshot.revision + 10),
    payload: {
      feature,
      historyAfter: snapshot.history.at(-1) ?? null,
    },
  })
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

it.each(["fillet", "chamfer"] as const)(
  "keeps all-edge %s inputs through History insert, update, replay, and projection",
  (kind) => {
    const created = createDocument()
    const target = insert(created.snapshot, box())
    const inserted = insert(target.snapshot, treatment(kind, "#edgeSize"))
    const saved = requireLastFeature(inserted.snapshot)
    expect(saved.semanticInputs).toEqual([])
    const parameters =
      kind === "fillet"
        ? { radius: createLengthQuantity(3, "mm", "3 mm") }
        : { distance: createLengthQuantity(3, "mm", "3 mm") }
    const { semanticInputs: _semanticInputs, ...savedRecord } = saved
    const legacy = featureRecordSchema.parse({ ...savedRecord, schemaVersion: 0 })
    const updated = applyVersionedDocumentCommand(inserted.snapshot, {
      ...envelope("org.vibeshape.feature.update", inserted.snapshot.revision, 100),
      payload: { feature: { ...legacy, parameters } },
    })
    expect(updated).toMatchObject({
      ok: true,
      snapshot: {
        features: [expect.anything(), { parameters, dependencies: [uuid(10)], semanticInputs: [] }],
      },
    })
    const updatedResult = requireSuccess(updated)
    const replayed = replayVersionedDocumentEvents(created.snapshot, [
      target.event,
      inserted.event,
      updatedResult.event,
    ])
    expect(replayed).toMatchObject({ ok: true })
    const replayedFeature = requireLastFeature(requireSuccess(replayed).snapshot)
    expect(replayedFeature?.dependencies).toEqual([uuid(10)])
    expect(replayedFeature?.parameters).toEqual(parameters)
    const projected = projectDocumentSnapshotV1ToV0(updatedResult.snapshot)
    expect(projected).toMatchObject({ ok: true, snapshot: { features: [{}, {}] } })
    const projectedFeature = requireLastFeature(requireSuccess(projected).snapshot)
    expect(projectedFeature?.dependencies).toEqual([uuid(10)])
    expect(projectedFeature?.parameters).toEqual(parameters)
    expect(projectedFeature?.parameters).toHaveProperty(
      kind === "fillet" ? "radius.source.expression" : "distance.source.expression",
      "3 mm",
    )
  },
)
