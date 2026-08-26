import { describe, expect, it } from "vitest"
import { canonicalJson } from "./canonical-json"
import { applyDocumentCommand, type DocumentEvent } from "./commands"
import type { DocumentSnapshot } from "./document"
import { migrateDocumentSnapshot } from "./document-migration"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"
import { sketchIdSchema } from "./identifiers"
import { boxFeatureType, extrusionFeatureType } from "./part-design"
import { createEmptySketch } from "./sketch-edit"
import { createLengthQuantity } from "./units"

const uuid = (value: number) => `0195b5ac-b220-7a2c-8c33-${value.toString().padStart(12, "0")}`
const actor = { type: "user", userId: "org.vibeshape.user.migration-test" } as const

function box(id: number): FeatureRecord {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: uuid(id),
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
    label: `Box ${id}`,
  })
}

function apply(
  snapshot: DocumentSnapshot | null,
  events: DocumentEvent[],
  command: Record<string, unknown>,
) {
  const result = applyDocumentCommand(snapshot, command)
  if (!result.ok) throw new Error(result.diagnostic.message)
  events.push(result.event)
  return result.snapshot
}

function interleavedJournal() {
  const documentId = uuid(1)
  const sketch = createEmptySketch({
    id: sketchIdSchema.parse(uuid(2)),
    label: "Layout",
    plane: "xy",
  })
  const feature = box(3)
  const events: DocumentEvent[] = []
  let snapshot = apply(null, events, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: uuid(101),
    documentId,
    baseRevision: 0,
    issuedAt: "2026-08-26T00:00:01.000Z",
    actor,
    payload: { name: "Migrated model" },
  })
  snapshot = apply(snapshot, events, {
    kind: "org.vibeshape.sketch.add",
    schemaVersion: 1,
    commandId: uuid(102),
    documentId,
    baseRevision: snapshot.revision,
    issuedAt: "2026-08-26T00:00:02.000Z",
    actor,
    payload: { sketch },
  })
  snapshot = apply(snapshot, events, {
    kind: "org.vibeshape.feature.add",
    schemaVersion: 1,
    commandId: uuid(103),
    documentId,
    baseRevision: snapshot.revision,
    issuedAt: "2026-08-26T00:00:03.000Z",
    actor,
    payload: { feature },
  })
  return { events, feature, sketch, snapshot }
}

function snapshotWithExtrusionAndUnavailableFeature() {
  const sketch = createEmptySketch({
    id: sketchIdSchema.parse(uuid(20)),
    label: "Profile",
    plane: "xy",
  })
  const extrusion = featureRecordSchema.parse({
    schemaVersion: 0,
    id: uuid(21),
    type: extrusionFeatureType.type,
    parameters: {
      profile: {
        schemaVersion: 0,
        sketchId: sketch.id,
        outerBoundaryEntityIds: [uuid(22)],
        holeBoundaryEntityIds: [],
      },
      distance: createLengthQuantity(12),
      symmetric: false,
      operation: "new",
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const unavailable = featureRecordSchema.parse({
    schemaVersion: 0,
    id: uuid(23),
    type: {
      moduleId: "org.example.extension",
      moduleVersion: "1.0.0",
      typeId: "org.example.feature.opaque",
      schemaVersion: 1,
    },
    parameters: { opaque: uuid(20) },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  return {
    schemaVersion: 0 as const,
    id: uuid(24),
    revision: 1,
    name: "Legacy extension",
    displayUnits: { length: "mm" as const, angle: "deg" as const },
    variables: [],
    sketches: [sketch],
    features: [extrusion, unavailable],
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  }
}

describe("document snapshot migration", () => {
  it("recovers interleaved History from a complete replay-equivalent journal", () => {
    const { events, feature, sketch, snapshot } = interleavedJournal()
    const result = migrateDocumentSnapshot(snapshot, events)

    expect(result).toMatchObject({ ok: true, provenance: "journal-derived" })
    if (!result.ok) return
    expect(result.snapshot.history).toEqual([
      { kind: "sketch", id: sketch.id },
      { kind: "feature", id: feature.id },
    ])
    expect(result.snapshot.features[0]?.semanticInputs).toEqual([])
  })

  it("tracks remove and re-add event order before dependency-safe stabilization", () => {
    const journal = interleavedJournal()
    let snapshot = journal.snapshot
    snapshot = apply(snapshot, journal.events, {
      kind: "org.vibeshape.sketch.remove",
      schemaVersion: 1,
      commandId: uuid(104),
      documentId: snapshot.id,
      baseRevision: snapshot.revision,
      issuedAt: "2026-08-26T00:00:04.000Z",
      actor,
      payload: { sketchId: journal.sketch.id },
    })
    const secondFeature = box(4)
    snapshot = apply(snapshot, journal.events, {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: uuid(105),
      documentId: snapshot.id,
      baseRevision: snapshot.revision,
      issuedAt: "2026-08-26T00:00:05.000Z",
      actor,
      payload: { feature: secondFeature },
    })
    snapshot = apply(snapshot, journal.events, {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: uuid(106),
      documentId: snapshot.id,
      baseRevision: snapshot.revision,
      issuedAt: "2026-08-26T00:00:06.000Z",
      actor,
      payload: { sketch: journal.sketch },
    })

    const result = migrateDocumentSnapshot(snapshot, journal.events)

    expect(result).toMatchObject({ ok: true, provenance: "journal-derived" })
    if (!result.ok) return
    expect(result.snapshot.history).toEqual([
      { kind: "feature", id: journal.feature.id },
      { kind: "feature", id: secondFeature.id },
      { kind: "sketch", id: journal.sketch.id },
    ])
  })

  it("falls back explicitly when the journal is incomplete, corrupt, or snapshot-inconsistent", () => {
    const { events, snapshot } = interleavedJournal()
    const incomplete = migrateDocumentSnapshot(snapshot, events.slice(1))
    const corrupt = migrateDocumentSnapshot(snapshot, [
      events[0],
      { ...events[1], revision: 99 },
      events[2],
    ])
    const inconsistent = migrateDocumentSnapshot({ ...snapshot, name: "Changed snapshot" }, events)

    expect(incomplete).toMatchObject({
      ok: true,
      provenance: "snapshot-derived",
      diagnostic: { code: "legacy-journal-unavailable" },
    })
    expect(corrupt).toMatchObject({
      ok: true,
      provenance: "snapshot-derived",
      diagnostic: { code: "legacy-journal-unavailable" },
    })
    expect(inconsistent).toMatchObject({
      ok: true,
      provenance: "snapshot-derived",
      diagnostic: { code: "legacy-journal-unavailable" },
    })
  })

  it("projects built-in semantic inputs and preserves unavailable extensions fail-closed", () => {
    const source = snapshotWithExtrusionAndUnavailableFeature()
    const result = migrateDocumentSnapshot(source)

    expect(result).toMatchObject({ ok: true, provenance: "snapshot-derived" })
    if (!result.ok) return
    expect(result.snapshot.features[0]?.semanticInputs).toEqual([
      { kind: "sketch", id: source.sketches[0]?.id },
    ])
    expect(result.snapshot.features[1]?.semanticInputs).toBeNull()
  })

  it("rejects a malformed known feature instead of treating it as an unavailable extension", () => {
    const source = snapshotWithExtrusionAndUnavailableFeature()
    const malformed = {
      ...source,
      features: [{ ...source.features[0], parameters: {} }, source.features[1]],
    }

    expect(migrateDocumentSnapshot(malformed)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-first-party-feature" },
    })
  })

  it("is byte-idempotent for an already migrated snapshot", () => {
    const first = migrateDocumentSnapshot(snapshotWithExtrusionAndUnavailableFeature())
    if (!first.ok) throw new Error(first.diagnostic.message)
    const second = migrateDocumentSnapshot(first.snapshot)

    expect(second).toMatchObject({ ok: true, provenance: "current" })
    if (!second.ok) return
    expect(canonicalJson(second.snapshot)).toBe(canonicalJson(first.snapshot))
  })
})
