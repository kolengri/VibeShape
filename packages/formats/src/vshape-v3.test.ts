import { describe, expect, it } from "bun:test"
import {
  applyDocumentUpgradeV2Command,
  applyDocumentV2Command,
  applyVersionedDocumentCommand,
  boxFeatureType,
  canonicalJson,
  createLengthQuantity,
} from "@vibeshape/domain"
import { strToU8, unzipSync, zipSync } from "fflate"
import { readAuthoredVShape, readVersionedVShape, readVShapeV3, writeVShapeV3 } from "./vshape"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const timestamp = "2026-10-03T00:00:00Z"
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function envelope(revision: number) {
  return {
    commandId: id(revision + 10),
    documentId: id(1),
    baseRevision: revision,
    issuedAt: timestamp,
    actor: { type: "user", userId: null },
  }
}
function project() {
  const created = success(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Assembly" },
    }),
  )
  const upgraded = success(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...envelope(1),
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  )
  const added = success(
    applyDocumentV2Command(upgraded.snapshot, {
      ...envelope(2),
      schemaVersion: 2,
      kind: "org.vibeshape.document.model-command",
      payload: {
        command: {
          ...envelope(2),
          schemaVersion: 1,
          kind: "org.vibeshape.history.insert-feature",
          payload: {
            historyAfter: null,
            feature: {
              schemaVersion: 0,
              id: id(200),
              type: boxFeatureType.type,
              label: "Housing",
              parameters: {
                width: createLengthQuantity(20),
                depth: createLengthQuantity(30),
                height: createLengthQuantity(40),
                centered: false,
              },
              dependencies: [],
              references: [],
              suppressed: false,
            },
          },
        },
        partAllocations: [
          {
            id: id(100),
            name: "Housing",
            origin: "independent",
            body: { schemaVersion: 0, featureId: id(200), outputRole: "result" },
          },
        ],
      },
    }),
  )
  const grouped = success(
    applyDocumentV2Command(added.snapshot, {
      ...envelope(3),
      schemaVersion: 2,
      kind: "org.vibeshape.document.metadata-command",
      payload: {
        kind: "folder.create",
        folder: {
          schemaVersion: 0,
          id: id(300),
          name: "Housing operations",
          items: added.snapshot.history,
        },
      },
    }),
  )
  return {
    snapshot: grouped.snapshot,
    seed: null,
    legacyEvents: [],
    versionedEvents: [created.event, upgraded.event, added.event, grouped.event],
    historyMode: "complete",
    promotionRevision: 0,
    upgradeRevision: 2,
    exportedAt: timestamp,
    createdBy: { application: "VibeShape", version: "test", build: null },
  }
}

describe("authored V3 archives", () => {
  it("round-trips stable parts, folders, and mixed original events", async () => {
    const input = project()
    const written = success(await writeVShapeV3(input))
    const read = success(await readVShapeV3(written.value))
    expect(canonicalJson(read.value.snapshot)).toBe(canonicalJson(input.snapshot))
    expect(read.value.versionedEvents).toEqual(input.versionedEvents)
    expect(success(await readAuthoredVShape(written.value)).value.version).toBe(3)
    expect(await readVersionedVShape(written.value)).toMatchObject({
      ok: false,
      diagnostic: { code: "unsupported-version" },
    })
  })

  it("rejects valid-looking snapshots that their journal does not reproduce", async () => {
    const input = project()
    expect(
      await writeVShapeV3({ ...input, snapshot: { ...input.snapshot, name: "Unjournaled" } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "history-mismatch" } })
    expect(await writeVShapeV3({ ...input, upgradeRevision: 3 })).toMatchObject({
      ok: false,
      diagnostic: { code: "history-mismatch" },
    })
  })

  it("preserves evidenced checkpoints as explicit checkpoint archives", async () => {
    const input = project()
    const written = success(
      await writeVShapeV3({
        ...input,
        seed: input.snapshot,
        versionedEvents: [],
        historyMode: "checkpoint",
        promotionRevision: input.snapshot.revision,
        migrationDiagnostic: {
          code: "legacy-journal-unavailable",
          message: "Journal record missing.",
        },
        unavailableRecords: ["event-authority:1"],
      }),
    )
    expect(success(await readVShapeV3(written.value)).value.manifest.historyMode).toBe("checkpoint")
    expect(
      await writeVShapeV3({
        ...input,
        seed: input.snapshot,
        versionedEvents: [],
        promotionRevision: input.snapshot.revision,
      }),
    ).toMatchObject({ ok: false })
  })

  it("checks every semantic entry and rejects undeclared or unsafe files", async () => {
    const written = success(await writeVShapeV3(project())).value
    const files = unzipSync(written)
    const mtime = new Date(1980, 0, 1)
    expect(
      await readVShapeV3(zipSync({ ...files, "document.json": strToU8("{}") }, { mtime })),
    ).toMatchObject({ ok: false, diagnostic: { code: "integrity-mismatch" } })
    expect(
      await readVShapeV3(zipSync({ ...files, "extra.json": strToU8("{}") }, { mtime })),
    ).toMatchObject({ ok: false, diagnostic: { code: "undeclared-entry" } })
    expect(
      await readVShapeV3(zipSync({ ...files, "../escape": strToU8("x") }, { mtime })),
    ).toMatchObject({ ok: false, diagnostic: { code: "unsafe-path" } })
  })
})
