import { describe, expect, it } from "bun:test"
import {
  assemblyDraftPreviewSchema,
  assemblyDraftStateSchema,
  assemblyInspectionViewSchema,
} from "@vibeshape/automation-api/assembly-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { applyVersionedDocumentCommand } from "@vibeshape/domain"
import { captureAssemblyDefinition } from "@vibeshape/domain/assembly-authority"
import {
  assemblyLibraryItemSchema,
  assemblyLibraryVersionSchema,
} from "@vibeshape/domain/assembly-library"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { applyDocumentUpgradeV2Command } from "@vibeshape/domain/document-v2-migration"
import { applyDocumentV3Command } from "@vibeshape/domain/document-v3-commands"
import type { DocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import { applyDocumentV4Command } from "@vibeshape/domain/document-v4-commands"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { vi } from "../../../tests/unit/support/bun-test"
import { createAssemblyAutomationSession } from "./assembly-session"
import type { AssemblyReviewInput, AssemblySessionConfiguration } from "./assembly-session-contract"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.assembly",
  sessionId: id(9),
})
const pose = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
const started = Date.parse("2026-10-04T00:00:00Z")
function success<T>(
  result: { ok: true; value: T } | { ok: false; diagnostic: { message: string } },
): T {
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}
function setup() {
  let sequence = 100
  let time = started
  let active = true
  const envelope = (revision: number) => ({
    documentId: id(1),
    commandId: id(++sequence),
    baseRevision: revision,
    issuedAt: new Date(started).toISOString(),
    actor,
  })
  const created = applyVersionedDocumentCommand(null, {
    ...envelope(0),
    schemaVersion: 1,
    kind: "org.vibeshape.document.create",
    payload: { name: "Assembly automation fixture" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const box = applyVersionedDocumentCommand(created.snapshot, {
    ...envelope(1),
    schemaVersion: 1,
    kind: "org.vibeshape.history.insert-feature",
    payload: {
      historyAfter: null,
      feature: {
        schemaVersion: 0,
        id: id(2),
        type: boxFeatureType.type,
        label: "Box",
        parameters: {
          width: createLengthQuantity(10),
          depth: createLengthQuantity(20),
          height: createLengthQuantity(30),
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed: false,
      },
    },
  })
  if (!box.ok) throw new Error(box.diagnostic.message)
  const authored = applyDocumentUpgradeV2Command(box.snapshot, {
    ...envelope(2),
    schemaVersion: 2,
    kind: "org.vibeshape.document.upgrade-v2",
    payload: {
      partAllocations: [
        {
          id: id(3),
          name: "Bracket",
          origin: "independent",
          body: { schemaVersion: 0, featureId: id(2), outputRole: "result" },
        },
      ],
    },
  })
  if (!authored.ok) throw new Error(authored.diagnostic.message)
  const textured = applyDocumentV3Command(authored.snapshot, {
    ...envelope(3),
    schemaVersion: 3,
    kind: "org.vibeshape.document.upgrade-v3",
    payload: { change: null },
  })
  if (!textured.ok) throw new Error(textured.diagnostic.message)
  const upgraded = applyDocumentV4Command(textured.snapshot, {
    ...envelope(4),
    schemaVersion: 4,
    kind: "org.vibeshape.document.upgrade-v4",
    payload: {},
  })
  if (!upgraded.ok) throw new Error(upgraded.diagnostic.message)
  let snapshot: DocumentSnapshotV4 = upgraded.snapshot
  const definition = captureAssemblyDefinition(snapshot, {
    schemaVersion: 1,
    id: id(10),
    name: "Frozen bracket",
    sources: [
      {
        kind: "part",
        partId: id(3),
        body: { schemaVersion: 0, featureId: id(2), outputRole: "result" },
        contentHash: "a".repeat(64),
      },
    ],
    sourceFrame: pose,
  })
  const item = assemblyLibraryItemSchema.parse({
    schemaVersion: 1,
    id: id(50),
    metadataRevision: 1,
    headVersion: 1,
    name: "Bracket",
    tags: ["fixture"],
    createdAt: new Date(started).toISOString(),
    updatedAt: new Date(started).toISOString(),
  })
  const version = assemblyLibraryVersionSchema.parse({
    schemaVersion: 1,
    itemId: item.id,
    version: 1,
    createdAt: new Date(started).toISOString(),
    definition,
    contentDigest: "b".repeat(64),
  })
  const frozen = { item, version, blobs: [] }
  const inspect = vi.fn<AssemblySessionConfiguration["inspect"]>(async (revision) => ({
    ok: true,
    value: assemblyInspectionViewSchema.parse({
      schemaVersion: 1,
      documentId: snapshot.id,
      revision,
      occurrences: [],
      interference: [],
      kinematics: {
        status: "fully-constrained",
        degreesOfFreedom: 0,
        maximumResidual: 0,
        redundant: false,
        redundantJointIds: [],
      },
    }),
  }))
  const preview = vi.fn<AssemblySessionConfiguration["preview"]>(async (_changes, revision) =>
    inspect(revision, { interferencePairs: [] }),
  )
  const commit = vi.fn<AssemblySessionConfiguration["commit"]>(async (input) => {
    const result = applyDocumentV4Command(
      snapshot,
      {
        ...envelope(input.baseRevision),
        commandId: id(++sequence),
        actor: input.actor,
        schemaVersion: 4,
        kind: "org.vibeshape.document.assembly-command",
        payload: { changes: input.changes },
      },
      { transactionId: input.draftId },
    )
    if (!result.ok) return localFailure(result.diagnostic.code, result.diagnostic.message)
    snapshot = result.snapshot
    return { ok: true, value: { revision: snapshot.revision } }
  })
  const review = vi.fn(async (_input: AssemblyReviewInput) => "approved" as const)
  const library: AssemblySessionConfiguration["library"] = {
    list: vi.fn<AssemblySessionConfiguration["library"]["list"]>(async () => ({
      ok: true,
      value: [item],
    })),
    read: vi.fn<AssemblySessionConfiguration["library"]["read"]>(async () => ({
      ok: true,
      value: frozen,
    })),
    prepareSource: vi.fn<AssemblySessionConfiguration["library"]["prepareSource"]>(async () => ({
      ok: true,
      value: { definition, blobs: [] },
    })),
    publish: vi.fn<AssemblySessionConfiguration["library"]["publish"]>(async () => ({
      ok: true,
      value: frozen,
    })),
    updateMetadata: vi.fn<AssemblySessionConfiguration["library"]["updateMetadata"]>(async () => ({
      ok: true,
      value: { ...item, metadataRevision: 2 },
    })),
  }
  const configuration: AssemblySessionConfiguration = {
    documentId: snapshot.id,
    isActive: () => active,
    readSnapshot: () => snapshot,
    createId: () => id(++sequence),
    now: () => time,
    inspect,
    preview,
    commit,
    review,
    library,
  }
  const session = createAssemblyAutomationSession(configuration)
  return {
    session,
    configuration,
    preview,
    commit,
    review,
    library,
    read: () => snapshot,
    changeRevision: () => {
      snapshot = { ...snapshot, revision: snapshot.revision + 1 }
    },
    expire: () => {
      time += 300_001
    },
    close: () => {
      active = false
    },
    definition,
    item,
  }
}
async function draft(fixture: ReturnType<typeof setup>) {
  return assemblyDraftStateSchema.parse(
    success(
      await fixture.session.execute(actor, {
        tool: "create_assembly_draft",
        arguments: { baseRevision: fixture.read().revision },
      }),
    ),
  )
}
const args = (state: ReturnType<typeof assemblyDraftStateSchema.parse>) => ({
  draftId: state.draftId,
  baseRevision: state.baseRevision,
  draftVersion: state.draftVersion,
})
async function upgrade(fixture: ReturnType<typeof setup>) {
  return assemblyDraftStateSchema.parse(
    success(
      await fixture.session.execute(actor, {
        tool: "upgrade_assembly",
        arguments: args(await draft(fixture)),
      }),
    ),
  )
}

describe("owned assembly automation", () => {
  it("stages private versions, exact-previews, revalidates after manual review, and commits the MCP actor once", async () => {
    const fixture = setup()
    const state = await upgrade(fixture)
    expect(state).toMatchObject({ baseRevision: 5, draftVersion: 1, changeCount: 1 })
    const view = assemblyDraftPreviewSchema.parse(
      success(
        await fixture.session.execute(actor, {
          tool: "preview_assembly_draft",
          arguments: args(state),
        }),
      ),
    )
    expect(view.assembly.assemblyVersion).toBe(2)
    expect(fixture.read().assembly.schemaVersion).toBe(1)
    expect(fixture.commit).not.toHaveBeenCalled()
    const result = await fixture.session.execute(actor, {
      tool: "commit_assembly_draft",
      arguments: args(state),
    })
    expect(result).toMatchObject({
      ok: true,
      value: { baseRevision: 5, revision: 6, changeCount: 1 },
    })
    expect(fixture.preview).toHaveBeenCalledTimes(3)
    expect(fixture.review).toHaveBeenCalledTimes(1)
    expect(fixture.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        draftId: state.draftId,
        baseRevision: 5,
        changes: [{ kind: "assembly.upgrade" }],
      }),
    )
    expect(fixture.read().assembly.schemaVersion).toBe(2)
    expect(
      await fixture.session.execute(actor, {
        tool: "commit_assembly_draft",
        arguments: args(state),
      }),
    ).toMatchObject({ ok: false })
    expect(fixture.commit).toHaveBeenCalledTimes(1)
  })
  it("rejects foreign actors, stale draft versions, disposal and expiry without persisting", async () => {
    const fixture = setup()
    const state = await upgrade(fixture)
    expect(
      await fixture.session.execute(
        { ...actor, sessionId: id(99) },
        { tool: "preview_assembly_draft", arguments: args(state) },
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-owner-mismatch" } })
    expect(
      await fixture.session.execute(actor, {
        tool: "preview_assembly_draft",
        arguments: { ...args(state), draftVersion: 0 },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-draft-version" } })
    fixture.expire()
    expect(
      await fixture.session.execute(actor, {
        tool: "commit_assembly_draft",
        arguments: args(state),
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-expired" } })
    fixture.session.dispose()
    expect(
      await fixture.session.execute(actor, { tool: "model_assembly", arguments: { revision: 5 } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
    expect(fixture.commit).not.toHaveBeenCalled()
  })
  it("blocks edits while the dialog is pending and discards stale approval", async () => {
    const fixture = setup()
    let approve: (decision: "approved") => void = () => {}
    const received = new Promise<void>((resolve) => {
      fixture.review.mockImplementation(() => {
        resolve()
        return new Promise((done) => {
          approve = done
        })
      })
    })
    const session = createAssemblyAutomationSession(fixture.configuration)
    const initial = assemblyDraftStateSchema.parse(
      success(
        await session.execute(actor, {
          tool: "create_assembly_draft",
          arguments: { baseRevision: 5 },
        }),
      ),
    )
    const state = assemblyDraftStateSchema.parse(
      success(await session.execute(actor, { tool: "upgrade_assembly", arguments: args(initial) })),
    )
    const pending = session.execute(actor, {
      tool: "commit_assembly_draft",
      arguments: args(state),
    })
    await received
    expect(
      await session.execute(actor, { tool: "upgrade_assembly", arguments: args(state) }),
    ).toMatchObject({ ok: false, diagnostic: { code: "busy" } })
    fixture.changeRevision()
    approve("approved")
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    expect(fixture.commit).not.toHaveBeenCalled()
  })
  it("never requests review or commit after an unsolvable preflight, including failures after review", async () => {
    const fixture = setup()
    const conflict = localFailure("conflicting-mates", "The authored mates conflict.")
    const checked = vi.fn().mockResolvedValueOnce(conflict)
    const session = createAssemblyAutomationSession({ ...fixture.configuration, preview: checked })
    const initial = assemblyDraftStateSchema.parse(
      success(
        await session.execute(actor, {
          tool: "create_assembly_draft",
          arguments: { baseRevision: 5 },
        }),
      ),
    )
    const state = assemblyDraftStateSchema.parse(
      success(await session.execute(actor, { tool: "upgrade_assembly", arguments: args(initial) })),
    )
    expect(
      await session.execute(actor, { tool: "commit_assembly_draft", arguments: args(state) }),
    ).toEqual(conflict)
    expect(fixture.review).not.toHaveBeenCalled()
    const afterReview = createAssemblyAutomationSession({
      ...fixture.configuration,
      preview: vi
        .fn()
        .mockImplementationOnce(async () => ({
          ok: true,
          value: success(await fixture.configuration.inspect(5, { interferencePairs: [] })),
        }))
        .mockResolvedValueOnce(conflict),
    })
    const other = assemblyDraftStateSchema.parse(
      success(
        await afterReview.execute(actor, {
          tool: "create_assembly_draft",
          arguments: { baseRevision: 5 },
        }),
      ),
    )
    const edited = assemblyDraftStateSchema.parse(
      success(
        await afterReview.execute(actor, { tool: "upgrade_assembly", arguments: args(other) }),
      ),
    )
    expect(
      await afterReview.execute(actor, { tool: "commit_assembly_draft", arguments: args(edited) }),
    ).toEqual(conflict)
    expect(fixture.commit).not.toHaveBeenCalled()
  })
  it("rechecks authority after asynchronous geometry and library reads", async () => {
    const fixture = setup()
    const stale = createAssemblyAutomationSession({
      ...fixture.configuration,
      inspect: async () => {
        fixture.changeRevision()
        return {
          ok: true,
          value: assemblyInspectionViewSchema.parse({
            schemaVersion: 1,
            documentId: id(1),
            revision: 5,
            occurrences: [],
            interference: [],
          }),
        }
      },
    })
    expect(
      await stale.execute(actor, { tool: "inspect_assembly", arguments: { revision: 5 } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    const library = createAssemblyAutomationSession({
      ...fixture.configuration,
      library: {
        ...fixture.configuration.library,
        list: async () => {
          fixture.changeRevision()
          return { ok: true, value: [fixture.item] }
        },
      },
    })
    expect(
      await library.execute(actor, { tool: "library_items", arguments: { revision: 6 } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
  })
  it("exposes library summaries without pins or bytes and stages explicit reference/copy identity", async () => {
    const fixture = setup()
    const result = success(
      await fixture.session.execute(actor, {
        tool: "library_version",
        arguments: { revision: 5, itemId: fixture.item.id, version: 1 },
      }),
    )
    expect(JSON.stringify(result)).not.toContain("pinnedModels")
    expect(JSON.stringify(result)).not.toContain('"bytes"')
    const state = await draft(fixture)
    const inserted = assemblyDraftStateSchema.parse(
      success(
        await fixture.session.execute(actor, {
          tool: "insert_library_version",
          arguments: {
            ...args(state),
            itemId: fixture.item.id,
            version: 1,
            mode: "reference",
            definitionId: id(60),
            definitionName: "Referenced bracket",
            instanceId: id(61),
            instanceName: "Ground",
            worldFrame: pose,
          },
        }),
      ),
    )
    expect(inserted.changeCount).toBe(2)
    const preview = assemblyDraftPreviewSchema.parse(
      success(
        await fixture.session.execute(actor, {
          tool: "preview_assembly_draft",
          arguments: args(inserted),
        }),
      ),
    )
    expect(preview.assembly.definitions[0]).toMatchObject({
      id: id(60),
      libraryBinding: { itemId: id(50), version: 1 },
    })
    expect(
      await fixture.session.execute(actor, {
        tool: "detach_library_definition",
        arguments: { ...args(inserted), definitionId: id(60) },
      }),
    ).toMatchObject({ ok: true, value: { changeCount: 3 } })
    expect(fixture.library.publish).not.toHaveBeenCalled()
    expect(fixture.commit).not.toHaveBeenCalled()
  })
  it("rejects caller-owned pins, bytes, approval flags and cross-draft input", async () => {
    const fixture = setup()
    const state = await draft(fixture)
    expect(
      await fixture.session.execute(actor, {
        tool: "create_assembly_definition",
        arguments: { ...args(state), definition: fixture.definition },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-operation" } })
    expect(
      await fixture.session.execute(actor, {
        tool: "commit_assembly_draft",
        arguments: { ...args(state), approved: true },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-operation" } })
    expect(
      await fixture.session.execute(actor, {
        tool: "save_library_definition",
        arguments: {
          baseRevision: 5,
          source: { kind: "part", id: id(3) },
          name: "Library",
          tags: [],
          expectedMetadataRevision: null,
          blobs: [],
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-operation" } })
  })
  it("invalidates pending previews on cancellation, expiry and disposal without caching late evidence", async () => {
    for (const interrupt of ["cancel", "expiry", "dispose"] as const) {
      const fixture = setup()
      let resolve: (result: Awaited<ReturnType<AssemblySessionConfiguration["preview"]>>) => void =
        () => {}
      const requested = new Promise<void>((received) => {
        fixture.preview.mockImplementation(
          () =>
            new Promise((done) => {
              resolve = done
              received()
            }),
        )
      })
      const state = await draft(fixture)
      const edited = assemblyDraftStateSchema.parse(
        success(
          await fixture.session.execute(actor, {
            tool: "upgrade_assembly",
            arguments: args(state),
          }),
        ),
      )
      const pending = fixture.session.execute(actor, {
        tool: "preview_assembly_draft",
        arguments: args(edited),
      })
      await requested
      if (interrupt === "expiry") fixture.expire()
      else if (interrupt === "dispose") fixture.session.dispose()
      else fixture.session.cancel()
      resolve({
        ok: true,
        value: success(await fixture.configuration.inspect(5, { interferencePairs: [] })),
      })
      expect(await pending).toMatchObject({
        ok: false,
        diagnostic: { code: interrupt === "expiry" ? "draft-expired" : "session-revoked" },
      })
      expect(fixture.commit).not.toHaveBeenCalled()
      expect(
        await fixture.session.execute(actor, {
          tool: "preview_assembly_draft",
          arguments: args(edited),
        }),
      ).toMatchObject({ ok: false })
    }
  })
  it("reviews detached frozen library content and requires the exact metadata and content receipt", async () => {
    const fixture = setup()
    vi.spyOn(fixture.library, "publish").mockImplementation(async (input) => ({
      ok: true,
      value: {
        item: assemblyLibraryItemSchema.parse({
          ...fixture.item,
          id: input.itemId,
          metadataRevision: 2,
          headVersion: 2,
          name: input.name,
          tags: input.tags,
          updatedAt: input.createdAt,
        }),
        version: assemblyLibraryVersionSchema.parse({
          schemaVersion: 1,
          itemId: input.itemId,
          version: 2,
          definition: input.definition,
          contentDigest: "c".repeat(64),
          createdAt: input.createdAt,
        }),
        blobs: [],
      },
    }))
    fixture.review.mockImplementation(async (input) => {
      Object.assign(fixture.definition, { pinRevision: 30 })
      Object.assign(input.library ?? {}, { name: "Unreviewed replacement" })
      return "approved"
    })
    const session = createAssemblyAutomationSession(fixture.configuration)
    const input = {
      baseRevision: 5,
      source: { kind: "part", id: id(3) },
      itemId: fixture.item.id,
      expectedMetadataRevision: 1,
      name: "Reviewed component",
      tags: ["reviewed"],
    }
    const result = success(
      await session.execute(actor, { tool: "save_library_definition", arguments: input }),
    )
    expect(result).toMatchObject({
      item: { name: "Reviewed component", metadataRevision: 2 },
      definition: { pinRevision: 1 },
    })
    expect(fixture.library.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedMetadataRevision: 1,
        name: "Reviewed component",
        definition: expect.objectContaining({ pinRevision: 1 }),
      }),
      expect.any(Function),
    )
    vi.spyOn(fixture.library, "updateMetadata").mockImplementation(async () => ({
      ok: true,
      value: assemblyLibraryItemSchema.parse({
        ...fixture.item,
        metadataRevision: 2,
        name: "Different content",
      }),
    }))
    expect(
      await session.execute(actor, {
        tool: "update_library_metadata",
        arguments: {
          baseRevision: 5,
          itemId: fixture.item.id,
          expectedMetadataRevision: 1,
          name: "Reviewed metadata",
          tags: [],
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-library-receipt" } })
  })
  it("preserves library metadata CAS failures and never publishes stale or expired approval", async () => {
    const fixture = setup()
    const input = {
      baseRevision: 5,
      itemId: fixture.item.id,
      expectedMetadataRevision: 1,
      name: "Renamed",
      tags: [],
    }
    vi.spyOn(fixture.library, "updateMetadata").mockImplementation(async () =>
      localFailure("stale-library-metadata", "Another writer changed this library item.", true),
    )
    const session = createAssemblyAutomationSession(fixture.configuration)
    expect(
      await session.execute(actor, { tool: "update_library_metadata", arguments: input }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-library-metadata" } })
    expect(fixture.library.updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ expectedMetadataRevision: 1 }),
      expect.any(Function),
    )
    fixture.review.mockImplementation(async () => {
      fixture.expire()
      return "approved"
    })
    expect(
      await session.execute(actor, {
        tool: "save_library_definition",
        arguments: { ...input, source: { kind: "part", id: id(3) } },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-expired" } })
    expect(fixture.library.publish).not.toHaveBeenCalled()
    fixture.review.mockImplementation(async () => {
      fixture.changeRevision()
      return "approved"
    })
    expect(
      await session.execute(actor, { tool: "update_library_metadata", arguments: input }),
    ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    expect(fixture.library.updateMetadata).toHaveBeenCalledTimes(1)
  })
})
