import {
  type AssemblyDraftState,
  assemblyDraftStateSchema,
} from "@vibeshape/automation-api/assembly-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { createAssemblyAutomationSession } from "@vibeshape/automation-host/assembly-session"
import type { AssemblySessionConfiguration } from "@vibeshape/automation-host/assembly-session-contract"
import {
  captureAssemblyDefinition,
  emptyAssemblyAuthority,
} from "@vibeshape/domain/assembly-authority"
import {
  assemblyLibraryItemSchema,
  assemblyLibraryVersionSchema,
} from "@vibeshape/domain/assembly-library"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { type DocumentSnapshotV4, documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import { applyDocumentV4Command } from "@vibeshape/domain/document-v4-commands"
import { documentSourceAssetClosure } from "@vibeshape/domain/source-asset-closure"
import { VibeShapeDatabase } from "@vibeshape/persistence"
import { afterEach, describe, expect, it } from "vitest"
import {
  assemblyLibraryFixture,
  libraryFixtureId as id,
} from "../../../../scripts/assembly-library-fixture"
import { assemblyUiFixture } from "../features/assembly/assembly-test-fixture"
import { materializeAssemblySourceAssets } from "./source-assets-rebuild"

function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
const databases: VibeShapeDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function setup() {
  const first = assemblyLibraryFixture()
  const firstOutput = first.asset.outputs[0]
  if (!firstOutput) throw new Error("Expected a frozen source output.")
  const digest = "787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472"
  const secondDocument = documentSnapshotV4Schema.parse(
    JSON.parse(
      JSON.stringify(first.document)
        .replaceAll(first.asset.id, id(90))
        .replaceAll(firstOutput, id(91))
        .replaceAll(first.asset.digest, digest),
    ),
  )
  const secondAsset = secondDocument.assets[0]
  const secondOutput = secondAsset?.outputs[0]
  if (!secondAsset || !secondOutput) throw new Error("Expected another frozen source output.")
  const secondDefinition = captureAssemblyDefinition(secondDocument, {
    schemaVersion: 1,
    id: id(51),
    name: "Second closure",
    sources: [{ kind: "asset-output", assetId: secondAsset.id, outputId: secondOutput, digest }],
    sourceFrame: first.definition.sourceFrame,
  })
  const seed = documentSnapshotV4Schema.parse({
    ...assemblyUiFixture().authority,
    schemaVersion: 4,
    surfaceTextures: [],
    assets: [],
    assembly: emptyAssemblyAuthority(),
  })
  let snapshot: DocumentSnapshotV4 = seed
  let sequence = 5_000
  const actor = commandActorSchema.parse({
    type: "mcp",
    clientId: "org.example.closure",
    sessionId: id(400),
  })
  const item = assemblyLibraryItemSchema.parse({
    schemaVersion: 1,
    id: id(401),
    metadataRevision: 2,
    headVersion: 2,
    name: "Closures",
    tags: [],
    createdAt: first.document.createdAt,
    updatedAt: first.document.updatedAt,
  })
  const database = new VibeShapeDatabase("disposable-assembly-final-closure")
  databases.push(database)
  const materialized: string[][] = []
  const committed: string[][] = []
  const inspect = async () => ({
    ok: true as const,
    value: {
      schemaVersion: 1 as const,
      documentId: snapshot.id,
      revision: snapshot.revision,
      occurrences: [],
      interference: [],
    },
  })
  const configuration: AssemblySessionConfiguration = {
    documentId: snapshot.id,
    isActive: () => true,
    readSnapshot: () => snapshot,
    createId: () => id(++sequence),
    inspect,
    async preview(changes, _base, blobs) {
      const applied = applyDocumentV4Command(snapshot, {
        schemaVersion: 4,
        kind: "org.vibeshape.document.assembly-command",
        commandId: id(++sequence),
        documentId: snapshot.id,
        baseRevision: snapshot.revision,
        issuedAt: first.document.updatedAt,
        actor,
        payload: { changes },
      })
      if (!applied.ok) throw new Error(applied.diagnostic.message)
      const materials = await materializeAssemblySourceAssets(database, applied.snapshot, blobs)
      materialized.push(materials.map(({ asset }) => asset.digest))
      return inspect()
    },
    async commit(input) {
      const applied = applyDocumentV4Command(
        snapshot,
        {
          schemaVersion: 4,
          kind: "org.vibeshape.document.assembly-command",
          commandId: id(++sequence),
          documentId: snapshot.id,
          baseRevision: snapshot.revision,
          issuedAt: first.document.updatedAt,
          actor,
          payload: { changes: input.changes },
        },
        { transactionId: input.draftId },
      )
      if (!applied.ok) return localFailure(applied.diagnostic.code, applied.diagnostic.message)
      expect(input.blobs.map(({ digest }) => digest).sort()).toEqual(
        documentSourceAssetClosure(seed, [applied.event], applied.snapshot)
          .map(({ digest }) => digest)
          .sort(),
      )
      committed.push(input.blobs.map(({ digest }) => digest))
      snapshot = applied.snapshot
      return { ok: true, value: { revision: snapshot.revision } }
    },
    review: async () => "approved",
    library: {
      list: async () => ({ ok: true, value: [item] }),
      read: async ({ version }) => ({
        ok: true,
        value: {
          item,
          version: assemblyLibraryVersionSchema.parse({
            schemaVersion: 1,
            itemId: item.id,
            version,
            contentDigest: "a".repeat(64),
            createdAt: first.document.createdAt,
            definition: version === 1 ? first.definition : secondDefinition,
          }),
          blobs: [version === 1 ? first.blob : { digest, bytes: new Uint8Array([4, 5, 6]) }],
        },
      }),
      prepareSource: async () => ({
        ok: true,
        value: { definition: first.definition, blobs: [first.blob] },
      }),
      publish: async () => localFailure("unused", "Unused fixture port."),
      updateMetadata: async () => localFailure("unused", "Unused fixture port."),
    },
  }
  const session = createAssemblyAutomationSession(configuration)
  let draft: AssemblyDraftState
  const stage = async (tool: string, args: Record<string, unknown> = {}) => {
    const input =
      tool === "create_assembly_draft"
        ? { baseRevision: seed.revision }
        : {
            draftId: draft.draftId,
            baseRevision: draft.baseRevision,
            draftVersion: draft.draftVersion,
            ...args,
          }
    const result = await session.execute(actor, { tool, arguments: input })
    if (
      tool === "create_assembly_draft" ||
      !["preview_assembly_draft", "commit_assembly_draft"].includes(tool)
    )
      draft = assemblyDraftStateSchema.parse(success(result))
    else success(result)
  }
  return { stage, item, first, digest, materialized, committed, session }
}
describe("disposable assembly bytes and retained authored history", () => {
  it("previews insert then remove plus another real edit with no final source bytes while committing history bytes", async () => {
    const f = setup()
    await f.stage("create_assembly_draft")
    await f.stage("insert_library_version", {
      itemId: f.item.id,
      version: 1,
      mode: "reference",
      definitionId: id(410),
      definitionName: "Temporary",
      instanceId: id(411),
      instanceName: "Temporary occurrence",
      worldFrame: f.first.definition.sourceFrame,
    })
    await f.stage("remove_assembly_definition", { definitionId: id(410), cascade: true })
    await f.stage("upgrade_assembly")
    await f.stage("preview_assembly_draft")
    await f.stage("commit_assembly_draft")
    expect(f.materialized).toEqual([[], [], []])
    expect(f.committed).toEqual([[f.first.blob.digest]])
    f.session.dispose()
  })
  it("previews only the final closure after two library versions while committing both frozen revisions", async () => {
    const f = setup()
    await f.stage("create_assembly_draft")
    await f.stage("insert_library_version", {
      itemId: f.item.id,
      version: 1,
      mode: "reference",
      definitionId: id(410),
      definitionName: "Reference",
      instanceId: id(411),
      instanceName: "Occurrence",
      worldFrame: f.first.definition.sourceFrame,
    })
    await f.stage("relink_library_definition", {
      itemId: f.item.id,
      version: 2,
      definitionId: id(410),
    })
    await f.stage("preview_assembly_draft")
    await f.stage("commit_assembly_draft")
    expect(f.materialized).toEqual([[f.digest], [f.digest], [f.digest]])
    expect(f.committed).toEqual([[f.first.blob.digest, f.digest]])
    f.session.dispose()
  })
})
