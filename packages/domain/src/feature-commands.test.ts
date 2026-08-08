import { describe, expect, it } from "vitest"
import { applyDocumentCommand, reduceDocumentEvent, replayDocumentEvents } from "./commands"
import { documentSnapshotSchema } from "./document"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const featureIds = {
  root: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
  dependent: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
  missing: "0195b5ac-b220-7a2c-8c33-67a36a7f3103",
} as const
const commandIds = [
  "0195b5ac-b214-7a2c-8c33-67a36a7f2101",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2102",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2103",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2104",
  "0195b5ac-b214-7a2c-8c33-67a36a7f2105",
] as const
const actor = { type: "user", userId: "org.vibeshape.user.alice" } as const

function feature(
  id: (typeof featureIds)[keyof typeof featureIds],
  dependencies: string[] = [],
  values: Partial<FeatureRecord> = {},
) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId: "org.vibeshape.feature.test",
      schemaVersion: 1,
    },
    parameters: { length: 10 },
    dependencies,
    references: [],
    suppressed: false,
    ...values,
  })
}

function createDocument() {
  const result = applyDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: commandIds[0],
    documentId,
    baseRevision: 0,
    issuedAt: "2026-08-08T12:00:00Z",
    actor,
    payload: { name: "Enclosure" },
  })

  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

function featureCommand(
  kind:
    | "org.vibeshape.feature.add"
    | "org.vibeshape.feature.update"
    | "org.vibeshape.feature.set-suppressed",
  baseRevision: number,
  payload: Record<string, unknown>,
) {
  return {
    kind,
    schemaVersion: 1,
    commandId: commandIds[baseRevision],
    documentId,
    baseRevision,
    issuedAt: new Date(Date.UTC(2026, 7, 8, 12, baseRevision)).toISOString(),
    actor,
    payload,
  }
}

function applyFeatureCommand(
  snapshot: ReturnType<typeof createDocument>["snapshot"],
  command: ReturnType<typeof featureCommand>,
) {
  const result = applyDocumentCommand(snapshot, command)

  if (!result.ok) throw new Error(`${result.diagnostic.code}: ${result.diagnostic.message}`)
  return result
}

describe("feature document commands", () => {
  it("adds, updates, suppresses, and replays feature state by document revision", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const addedRoot = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const dependent = feature(featureIds.dependent, [featureIds.root])
    const addedDependent = applyFeatureCommand(
      addedRoot.snapshot,
      featureCommand("org.vibeshape.feature.add", 2, { feature: dependent }),
    )
    const updatedRoot = feature(featureIds.root, [], {
      parameters: { width: 20, length: 12 },
      label: "Base sketch",
    })
    const updated = applyFeatureCommand(
      addedDependent.snapshot,
      featureCommand("org.vibeshape.feature.update", 3, { feature: updatedRoot }),
    )
    const suppressed = applyFeatureCommand(
      updated.snapshot,
      featureCommand("org.vibeshape.feature.set-suppressed", 4, {
        featureId: featureIds.dependent,
        suppressed: true,
      }),
    )

    expect(suppressed.snapshot).toMatchObject({ revision: 5 })
    expect(suppressed.snapshot.features.map(({ id }) => id)).toEqual([
      featureIds.root,
      featureIds.dependent,
    ])
    expect(suppressed.snapshot.features[0]).toEqual(updatedRoot)
    expect(suppressed.snapshot.features[1]?.suppressed).toBe(true)
    expect(updated.event).toMatchObject({
      type: "org.vibeshape.feature.updated",
      previousFeature: root,
      feature: updatedRoot,
    })
    expect(suppressed.event).toMatchObject({
      type: "org.vibeshape.feature.suppression-changed",
      previousSuppressed: false,
      suppressed: true,
    })
    expect(
      replayDocumentEvents([
        created.event,
        addedRoot.event,
        addedDependent.event,
        updated.event,
        suppressed.event,
      ]),
    ).toEqual({ ok: true, snapshot: suppressed.snapshot })
  })

  it("rejects duplicate, missing, cyclic, and no-op mutations without partial state", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const addedRoot = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const dependent = feature(featureIds.dependent, [featureIds.root])
    const addedDependent = applyFeatureCommand(
      addedRoot.snapshot,
      featureCommand("org.vibeshape.feature.add", 2, { feature: dependent }),
    )
    const before = JSON.stringify(addedDependent.snapshot)

    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.add", 3, { feature: root }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-already-exists" } })
    expect(
      applyDocumentCommand(
        created.snapshot,
        featureCommand("org.vibeshape.feature.add", 1, { feature: dependent }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-graph" } })
    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.update", 3, {
          feature: feature(featureIds.root, [featureIds.dependent]),
        }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-graph" } })
    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.update", 3, {
          feature: feature(featureIds.missing),
        }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-not-found" } })
    expect(
      applyDocumentCommand(
        addedDependent.snapshot,
        featureCommand("org.vibeshape.feature.update", 3, {
          feature: { ...root, parameters: { length: 10 } },
        }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "command-no-op" } })
    expect(JSON.stringify(addedDependent.snapshot)).toBe(before)
  })

  it("rejects tampered feature events even when their payloads remain schema-valid", () => {
    const created = createDocument()
    const root = feature(featureIds.root)
    const added = applyFeatureCommand(
      created.snapshot,
      featureCommand("org.vibeshape.feature.add", 1, { feature: root }),
    )
    const updated = applyFeatureCommand(
      added.snapshot,
      featureCommand("org.vibeshape.feature.update", 2, {
        feature: { ...root, parameters: { length: 12 } },
      }),
    )

    if (updated.event.type !== "org.vibeshape.feature.updated") {
      throw new Error("The update fixture must emit a feature update event.")
    }

    expect(
      reduceDocumentEvent(added.snapshot, {
        ...updated.event,
        previousFeature: { ...root, parameters: { length: 11 } },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
    expect(
      reduceDocumentEvent(added.snapshot, {
        ...updated.event,
        feature: feature(featureIds.dependent),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })

  it("defaults old in-memory fixtures to an empty graph and rejects invalid snapshots", () => {
    const input = {
      schemaVersion: 0,
      id: documentId,
      revision: 1,
      name: "Enclosure",
      createdAt: "2026-08-08T12:00:00Z",
      updatedAt: "2026-08-08T12:00:00Z",
    }

    expect(documentSnapshotSchema.parse(input).features).toEqual([])
    expect(
      documentSnapshotSchema.safeParse({
        ...input,
        features: [feature(featureIds.dependent, [featureIds.root])],
      }).success,
    ).toBe(false)
  })
})
