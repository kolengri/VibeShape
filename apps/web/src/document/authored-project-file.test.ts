import { documentIdSchema, draftIdSchema } from "@vibeshape/domain/identifiers"
import { readAuthoredVShape, writeVShapeV5 } from "@vibeshape/formats/vshape"
import { describe, expect, it } from "vitest"
import {
  authorityTimestamp,
  evidenceValue,
} from "../../../../scripts/authority-persistence-fixture"
import { sourceAssetsFixture } from "../../../../scripts/source-assets-fixture"
import { copyBrowserPortableProject, portableProjectFromArchive } from "./authored-project-file"

const id = (n: number) => `0195b5ac-b260-7a2c-8c33-${String(n).padStart(12, "0")}`

async function sourceProject() {
  const f = await sourceAssetsFixture()
  const bytes = evidenceValue(
    await writeVShapeV5({
      snapshot: f.added.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: [
        f.authored.created.event,
        f.authored.added.event,
        f.authored.upgraded.event,
        f.textureUpgraded.event,
        f.upgraded.event,
        f.added.event,
      ],
      assetBlobs: [f.blob],
      historyMode: "complete",
      promotionRevision: 0,
      upgradeRevision: 3,
      textureUpgradeRevision: 4,
      sourceUpgradeRevision: 5,
      migrationDiagnostic: null,
      unavailableRecords: [],
      exportedAt: authorityTimestamp,
      createdBy: { application: "VibeShape", version: "0.0.0", build: null },
    }),
  ).value
  return evidenceValue(
    portableProjectFromArchive(evidenceValue(await readAuthoredVShape(bytes)).value),
  ).value
}

describe("browser portable source authority", () => {
  it("keeps native V5 source bytes and provenance when creating an independent project copy", async () => {
    const source = await sourceProject()
    let command = 500
    const copied = evidenceValue(
      copyBrowserPortableProject({
        source,
        documentId: documentIdSchema.parse(id(1)),
        name: "Independent import",
        issuedAt: authorityTimestamp,
        nextCommandId: () => id(command++),
        nextTransactionId: () => draftIdSchema.parse(id(command++)),
      }),
    ).value
    expect(copied.version).toBe(5)
    if (copied.version !== 5 || source.version !== 5)
      throw new Error("Source-backed copies require V5")
    expect(copied.project.snapshot).toMatchObject({
      id: id(1),
      name: "Independent import",
      schemaVersion: 4,
      assets: source.project.snapshot.assets,
    })
    expect(copied.project.sourceUpgradeRevision).toBe(source.project.sourceUpgradeRevision)
    expect(copied.project.assetBlobs).toEqual(source.project.assetBlobs)
    expect(copied.project.assetBlobs[0]?.bytes).not.toBe(source.project.assetBlobs[0]?.bytes)
    const archive = evidenceValue(
      await writeVShapeV5({
        ...copied.project,
        exportedAt: authorityTimestamp,
        createdBy: { application: "VibeShape", version: "0.0.0", build: null },
      }),
    ).value
    const reopened = evidenceValue(
      portableProjectFromArchive(evidenceValue(await readAuthoredVShape(archive)).value),
    ).value
    expect(reopened).toEqual(copied)
  })

  it("rejects checkpoint copies before publishing incomplete source history", async () => {
    const source = await sourceProject()
    if (source.version !== 5) throw new Error("Expected source-backed authority")
    expect(
      copyBrowserPortableProject({
        source: { version: 5, project: { ...source.project, historyMode: "checkpoint" } },
        documentId: documentIdSchema.parse(id(1)),
        name: "Incomplete copy",
        issuedAt: authorityTimestamp,
        nextCommandId: () => id(500),
        nextTransactionId: () => draftIdSchema.parse(id(501)),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "checkpoint-read-only" } })
  })
})
