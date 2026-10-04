import { automationDraftInspectionViewSchema } from "@vibeshape/automation-api/draft-inspection"
import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import {
  createCommandDispatcher,
  createCoreCommandHandlers,
} from "@vibeshape/domain/command-dispatcher"
import { applyDocumentCommand, commandActorSchema } from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { createFeatureTypeRegistry } from "@vibeshape/domain/feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "@vibeshape/domain/modules"
import { boxFeatureType, partDesignFeatureTypeHandlers } from "@vibeshape/domain/part-design"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { describe, expect, it, vi } from "vitest"
import { type AutomationDocumentPort, createAutomationHost } from "./host"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const draftId = "0195b5ac-b216-7a2c-bc33-67a36a7f21ac"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3000"
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac",
})
const otherActor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.other",
  sessionId: "0195b5ac-b219-7a2c-8c33-67a36a7f21ac",
})

function dispatchers() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const features = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!features.ok) throw new Error(features.diagnostic.message)
  const commands = createCommandDispatcher(
    modules.registry,
    createCoreCommandHandlers(features.registry),
  )
  const queries = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!commands.ok || !queries.ok) throw new Error("Could not create test dispatchers")
  return { commandDispatcher: commands.dispatcher, queryDispatcher: queries.dispatcher }
}

function snapshotWithBox() {
  const created = applyDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: "0195b5ac-b21a-7a2c-8c33-67a36a7f21ac",
    documentId,
    baseRevision: 0,
    issuedAt: "2026-08-08T12:00:00.000Z",
    actor,
    payload: { name: "Box" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const added = applyDocumentCommand(created.snapshot, {
    kind: "org.vibeshape.feature.add",
    schemaVersion: 1,
    commandId: "0195b5ac-b21b-7a2c-8c33-67a36a7f21ac",
    documentId,
    baseRevision: created.snapshot.revision,
    issuedAt: "2026-08-08T12:00:01.000Z",
    actor,
    payload: {
      feature: {
        schemaVersion: 0,
        id: featureId,
        type: boxFeatureType.type,
        parameters: {
          width: createLengthQuantity(20),
          depth: createLengthQuantity(30),
          height: createLengthQuantity(40),
          centered: true,
        },
        dependencies: [],
        references: [],
        suppressed: false,
      },
    },
  })
  if (!added.ok) throw new Error(added.diagnostic.message)
  return added.snapshot
}

function edgeEvidence(snapshot: DocumentSnapshot, rebuildId = "draft-rebuild") {
  return {
    ok: true as const,
    evidence: {
      schemaVersion: 1 as const,
      documentId: snapshot.id,
      revision: snapshot.revision,
      generation: 1,
      rebuildId,
      featureId,
      contentHash: "a".repeat(64),
      candidates: [0, 1].map((index) => ({
        candidateId: `edge-${index}`,
        kind: "edge" as const,
        semanticRole: `edge:${index}`,
        lineageTokens: [`lineage:${index}`],
        signature: {
          kind: "edge" as const,
          geometryClass: "LINE",
          measure: 10,
          centroid: [index, 0, 0] as [number, number, number],
          bounds: {
            min: [index, 0, 0] as [number, number, number],
            max: [index + 1, 0, 0] as [number, number, number],
          },
          boundaryCount: 2,
          adjacentGeometryClasses: [],
        },
      })),
    },
  }
}

function hostFixture(
  options: {
    now?: () => number
    inspectEdges?: (snapshot: DocumentSnapshot) => unknown
    inspectBodyMeasurements?: (snapshot: DocumentSnapshot) => unknown
    inspectBodyTopology?: (snapshot: DocumentSnapshot) => unknown
    evaluate?: (snapshot: DocumentSnapshot) => unknown
  } = {},
) {
  const snapshot = snapshotWithBox()
  let current: DocumentSnapshot | null = snapshot
  const documents: AutomationDocumentPort = {
    readSnapshot: () => current,
    compareAndCommitDraft: () => ({
      ok: false,
      diagnostic: {
        code: "document-write-unavailable",
        message: "unused",
        retryable: false,
        issues: [],
      },
    }),
  }
  const geometry = {
    evaluate: options.evaluate ? vi.fn(options.evaluate) : vi.fn(),
    ...(options.inspectBodyMeasurements
      ? { inspectBodyMeasurements: vi.fn(options.inspectBodyMeasurements) }
      : {}),
    ...(options.inspectBodyTopology
      ? { inspectBodyTopology: vi.fn(options.inspectBodyTopology) }
      : {}),
    ...(options.inspectEdges ? { inspectEdges: vi.fn(options.inspectEdges) } : {}),
  }
  const created = createAutomationHost({
    ...dispatchers(),
    documents,
    geometry,
    review: { confirm: () => "approved" },
    createDraftId: () => draftId,
    now: options.now ?? (() => 1_000),
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  return {
    host: created.host,
    snapshot,
    geometry,
    replace: (next: DocumentSnapshot | null) => {
      current = next
    },
  }
}

function request(fixture: ReturnType<typeof hostFixture>, query: Record<string, unknown>) {
  return fixture.host
    .createDraft(actor, { schemaVersion: 1, documentId, baseRevision: 2 })
    .then((created) => {
      if (!created.ok) throw new Error(created.diagnostic.message)
      return fixture.host.inspectDraft(actor, {
        schemaVersion: 1,
        draftId,
        query: { ...query, documentId, revision: created.value.revision },
      })
    })
}

describe("automation draft inspection", () => {
  it("serves semantic inspection without geometry and binds ownership and revision", async () => {
    const fixture = hostFixture()
    const result = await request(fixture, {
      kind: "org.vibeshape.cad.inspection.list",
      schemaVersion: 1,
      cursor: null,
      limit: 10,
    })
    expect(result.ok).toBe(true)
    expect(fixture.geometry.evaluate).not.toHaveBeenCalled()
    await expect(
      fixture.host.inspectDraft(otherActor, {
        schemaVersion: 1,
        draftId,
        query: {
          kind: "org.vibeshape.cad.inspection.list",
          schemaVersion: 1,
          documentId,
          revision: 3,
          cursor: null,
          limit: 10,
        },
      }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "draft-owner-mismatch" } })
    await expect(
      fixture.host.inspectDraft(actor, {
        schemaVersion: 1,
        draftId,
        query: {
          kind: "org.vibeshape.cad.inspection.list",
          schemaVersion: 1,
          documentId,
          revision: 99,
          cursor: null,
          limit: 10,
        },
      }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "stale-query-revision" } })
  })

  it("caches one edge catalog for paging and rejects a cursor without rebuilding", async () => {
    const fixture = hostFixture({ inspectEdges: (snapshot) => edgeEvidence(snapshot) })
    const first = await request(fixture, {
      kind: "org.vibeshape.model.edges",
      schemaVersion: 1,
      featureId,
      cursor: null,
      limit: 1,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const view = automationDraftInspectionViewSchema.parse(first.value)
    expect(view.view.kind).toBe("org.vibeshape.model.edges")
    if (view.view.kind !== "org.vibeshape.model.edges") return
    const cursor = view.view.nextCursor
    expect(cursor).not.toBeNull()
    const second = await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: {
        kind: "org.vibeshape.model.edges",
        schemaVersion: 1,
        documentId,
        revision: view.draft.revision,
        featureId,
        cursor,
        limit: 1,
      },
    })
    expect(second.ok).toBe(true)
    expect(fixture.geometry.inspectEdges).toHaveBeenCalledOnce()
    const miss = await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: {
        kind: "org.vibeshape.model.edges",
        schemaVersion: 1,
        documentId,
        revision: view.draft.revision,
        featureId,
        cursor: { ...cursor, rebuildId: "other" },
        limit: 1,
      },
    })
    expect(miss).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
    expect(fixture.geometry.inspectEdges).toHaveBeenCalledOnce()

    const cold = hostFixture({ inspectEdges: (snapshot) => edgeEvidence(snapshot) })
    const coldResult = await request(cold, {
      kind: "org.vibeshape.model.edges",
      schemaVersion: 1,
      featureId,
      cursor: { rebuildId: "missing", featureId, offset: 0 },
      limit: 1,
    })
    expect(coldResult).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
    expect(cold.geometry.inspectEdges).not.toHaveBeenCalled()
  })

  it("does not renew expiry and expires inspection after the original TTL", async () => {
    let now = 1_000
    const fixture = hostFixture({ now: () => now })
    const first = await request(fixture, {
      kind: "org.vibeshape.cad.inspection.list",
      schemaVersion: 1,
      cursor: null,
      limit: 1,
    })
    expect(first.ok).toBe(true)
    now = 101_000
    const renewed = await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: {
        kind: "org.vibeshape.cad.inspection.list",
        schemaVersion: 1,
        documentId,
        revision: 2,
        cursor: null,
        limit: 1,
      },
    })
    expect(renewed.ok).toBe(true)
    now = 301_001
    await expect(
      fixture.host.inspectDraft(actor, {
        schemaVersion: 1,
        draftId,
        query: {
          kind: "org.vibeshape.cad.inspection.list",
          schemaVersion: 1,
          documentId,
          revision: 2,
          cursor: null,
          limit: 1,
        },
      }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "draft-expired" } })
  })

  it("rejects malformed edge evidence without retaining it", async () => {
    const fixture = hostFixture({
      inspectEdges: () => ({ ok: true, evidence: { malformed: true } }),
    })
    const result = await request(fixture, {
      kind: "org.vibeshape.model.edges",
      schemaVersion: 1,
      featureId,
      cursor: null,
      limit: 1,
    })
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-geometry-evidence" } })
  })

  it("rejects a stale committed base before asking geometry for evidence", async () => {
    const inspectEdges = vi.fn((snapshot: DocumentSnapshot) => edgeEvidence(snapshot))
    const fixture = hostFixture({ inspectEdges })
    const created = await fixture.host.createDraft(actor, {
      schemaVersion: 1,
      documentId,
      baseRevision: 2,
    })
    expect(created.ok).toBe(true)
    fixture.replace(null)
    const result = await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: {
        kind: "org.vibeshape.model.edges",
        schemaVersion: 1,
        documentId,
        revision: 2,
        featureId,
        cursor: null,
        limit: 1,
      },
    })
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "document-not-found" } })
    expect(inspectEdges).not.toHaveBeenCalled()
  })

  it("revalidates committed base and TTL after asynchronous edge inspection", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let now = 1_000
    const inspectEdges = vi.fn(async (snapshot: DocumentSnapshot) => {
      await gate
      return edgeEvidence(snapshot)
    })
    const fixture = hostFixture({ now: () => now, inspectEdges })
    const created = await fixture.host.createDraft(actor, {
      schemaVersion: 1,
      documentId,
      baseRevision: 2,
    })
    expect(created.ok).toBe(true)
    const pending = fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: {
        kind: "org.vibeshape.model.edges",
        schemaVersion: 1,
        documentId,
        revision: 2,
        featureId,
        cursor: null,
        limit: 1,
      },
    })
    fixture.replace(null)
    release()
    await expect(pending).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "document-not-found" },
    })

    const second = hostFixture({
      now: () => now,
      inspectEdges: async (snapshot) => {
        await gate
        return edgeEvidence(snapshot)
      },
    })
    const secondCreated = await second.host.createDraft(actor, {
      schemaVersion: 1,
      documentId,
      baseRevision: 2,
    })
    expect(secondCreated.ok).toBe(true)
    now = 301_001
    const expired = await second.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: {
        kind: "org.vibeshape.model.edges",
        schemaVersion: 1,
        documentId,
        revision: 2,
        featureId,
        cursor: null,
        limit: 1,
      },
    })
    expect(expired).toMatchObject({ ok: false, diagnostic: { code: "draft-expired" } })
  })

  it("invalidates the cached catalog after a command and discard", async () => {
    const fixture = hostFixture({ inspectEdges: (snapshot) => edgeEvidence(snapshot) })
    const first = await request(fixture, {
      kind: "org.vibeshape.model.edges",
      schemaVersion: 1,
      featureId,
      cursor: null,
      limit: 1,
    })
    expect(first.ok).toBe(true)
    if (!first.ok || first.value.view.kind !== "org.vibeshape.model.edges") return
    const cursor = first.value.view.nextCursor
    expect(cursor).not.toBeNull()
    const changed = await fixture.host.applyCommand(actor, {
      schemaVersion: 1,
      draftId,
      command: {
        kind: "org.vibeshape.document.rename",
        schemaVersion: 1,
        commandId: "0195b5ac-b222-7a2c-8c33-67a36a7f21ac",
        documentId,
        baseRevision: 2,
        issuedAt: "2026-08-08T12:00:02.000Z",
        actor,
        payload: { name: "Changed" },
      },
    })
    expect(changed.ok).toBe(true)
    const stale = await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: {
        kind: "org.vibeshape.model.edges",
        schemaVersion: 1,
        documentId,
        revision: 3,
        featureId,
        cursor,
        limit: 1,
      },
    })
    expect(stale).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
    expect(fixture.geometry.inspectEdges).toHaveBeenCalledOnce()
    await expect(
      fixture.host.discardDraft(actor, { schemaVersion: 1, draftId }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      fixture.host.inspectDraft(actor, {
        schemaVersion: 1,
        draftId,
        query: {
          kind: "org.vibeshape.cad.inspection.list",
          schemaVersion: 1,
          documentId,
          revision: 3,
          cursor: null,
          limit: 1,
        },
      }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "draft-not-found" } })
  })

  it("protects the owned draft snapshot from a mutating geometry port", async () => {
    const inspectEdges = vi.fn((snapshot: DocumentSnapshot) => {
      Object.assign(snapshot, { features: [] })
      return edgeEvidence(snapshot)
    })
    const fixture = hostFixture({ inspectEdges })
    const edge = await request(fixture, {
      kind: "org.vibeshape.model.edges",
      schemaVersion: 1,
      featureId,
      cursor: null,
      limit: 1,
    })
    expect(edge.ok).toBe(true)
    const tree = await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: {
        kind: "org.vibeshape.cad.inspection.list",
        schemaVersion: 1,
        documentId,
        revision: 2,
        cursor: null,
        limit: 10,
      },
    })
    expect(tree).toMatchObject({ ok: true, value: { view: { data: { total: 1 } } } })
  })
})

function bodyTopologyEvidence(snapshot: DocumentSnapshot) {
  const edges = edgeEvidence(snapshot)
  return {
    ok: true,
    evidence: {
      ...edges.evidence,
      outputRole: "result",
      kind: "face",
      candidates: edges.evidence.candidates.map((candidate) => ({
        ...candidate,
        kind: "face",
        signature: { ...candidate.signature, kind: "face", geometryClass: "PLANE", measure: 100 },
      })),
    },
  }
}
const topologyQuery = {
  kind: "org.vibeshape.model.body-topology",
  schemaVersion: 1,
  documentId,
  featureId,
  outputRole: "result",
  topologyKind: "face",
  cursor: null,
  limit: 1,
}
it("owns one scoped draft body catalog and rejects stale or cross-target cursors", async () => {
  const fixture = hostFixture({
    inspectBodyTopology: bodyTopologyEvidence,
    inspectEdges: edgeEvidence,
  })
  const first = await request(fixture, topologyQuery)
  expect(first.ok).toBe(true)
  if (!first.ok || first.value.view.kind !== "org.vibeshape.model.body-topology")
    throw new Error("Expected body topology")
  const cursor = first.value.view.nextCursor
  expect(cursor).not.toBeNull()
  const query = { ...topologyQuery, revision: first.value.draft.revision, cursor }
  expect(
    await fixture.host.inspectDraft(actor, { schemaVersion: 1, draftId, query }),
  ).toMatchObject({
    ok: true,
    value: { view: { outputRole: "result", contentHash: "a".repeat(64) } },
  })
  expect(fixture.geometry.inspectBodyTopology).toHaveBeenCalledOnce()
  expect(
    await fixture.host.inspectDraft(otherActor, { schemaVersion: 1, draftId, query }),
  ).toMatchObject({ ok: false, diagnostic: { code: "draft-owner-mismatch" } })
  expect(
    await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: { ...query, outputRole: "pattern.instance.1" },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  expect(
    await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: { ...query, cursor: { ...cursor, rebuildId: "other-rebuild" } },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  expect(
    await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: {
        kind: "org.vibeshape.model.edges",
        schemaVersion: 1,
        documentId,
        revision: query.revision,
        featureId,
        cursor: null,
        limit: 1,
      },
    }),
  ).toMatchObject({ ok: true })
  expect(
    await fixture.host.inspectDraft(actor, { schemaVersion: 1, draftId, query }),
  ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  expect(fixture.geometry.inspectBodyTopology).toHaveBeenCalledOnce()
})
it("revalidates the draft base after disposable body inspection before retaining its catalog", async () => {
  let fixture: ReturnType<typeof hostFixture>
  fixture = hostFixture({
    inspectBodyTopology: (snapshot) => {
      fixture.replace({ ...snapshot, revision: snapshot.revision + 1 })
      return bodyTopologyEvidence(snapshot)
    },
  })
  expect(await request(fixture, topologyQuery)).toMatchObject({
    ok: false,
    diagnostic: { code: "stale-revision" },
  })
})

it("keeps body measurements on one bounded catalog and invalidates paging after a draft edit", async () => {
  const shape = {
    valid: true,
    volume: 24000,
    surfaceArea: 5200,
    bounds: { min: [0, 0, 0], max: [20, 30, 40] },
    solidCount: 1,
    faceCount: 6,
    edgeCount: 12,
  }
  const fixture = hostFixture({
    inspectBodyMeasurements: (snapshot) => ({
      ok: true,
      evidence: {
        schemaVersion: 1,
        documentId: snapshot.id,
        revision: snapshot.revision,
        generation: 1,
        features: [{ featureId, status: "succeeded", contentHash: "a".repeat(64), shape }],
        bodies: [{ featureId, contentHash: "a".repeat(64), outputRole: "result", shape }],
      },
    }),
  })
  const query = {
    kind: "org.vibeshape.model.body-measurements",
    schemaVersion: 1,
    documentId,
    revision: 2,
    featureId,
    cursor: null,
    limit: 1,
  }
  const result = await request(fixture, query)
  expect(result).toMatchObject({
    ok: true,
    value: {
      view: { data: { bodies: [{ featureId, outputRole: "result", shape: { volume: 24000 } }] } },
    },
  })
  expect(
    await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: { ...query, cursor: "0" },
    }),
  ).toMatchObject({ ok: true })
  expect(fixture.geometry.inspectBodyMeasurements).toHaveBeenCalledOnce()
  const changed = await fixture.host.applyCommand(actor, {
    schemaVersion: 1,
    draftId,
    command: {
      kind: "org.vibeshape.document.rename",
      schemaVersion: 1,
      commandId: "0195b5ac-b222-7a2c-8c33-67a36a7f21ac",
      documentId,
      baseRevision: 2,
      issuedAt: "2026-08-08T12:00:02.000Z",
      actor,
      payload: { name: "Edited" },
    },
  })
  expect(changed.ok).toBe(true)
  expect(
    await fixture.host.inspectDraft(actor, {
      schemaVersion: 1,
      draftId,
      query: { ...query, revision: 3, cursor: "0" },
    }),
  ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  expect(fixture.geometry.inspectBodyMeasurements).toHaveBeenCalledOnce()
})
it("rejects authority expiration during body calculation without retaining a cursor", async () => {
  let now = 1000
  const fixture = hostFixture({
    now: () => now,
    inspectBodyTopology: (snapshot) => {
      now = 310000
      return bodyTopologyEvidence(snapshot)
    },
  })
  expect(await request(fixture, topologyQuery)).toMatchObject({
    ok: false,
    diagnostic: { code: "draft-expired" },
  })
})
it("marks an unknown support diagnostic invalid even when all solids succeeded", async () => {
  const shape = {
    valid: true,
    volume: 24000,
    surfaceArea: 5200,
    bounds: { min: [0, 0, 0], max: [20, 30, 40] },
    solidCount: 1,
    faceCount: 6,
    edgeCount: 12,
  }
  const fixture = hostFixture({
    evaluate: (snapshot) => ({
      measurements: {
        schemaVersion: 1,
        documentId: snapshot.id,
        revision: snapshot.revision,
        generation: 1,
        features: [{ featureId, status: "succeeded", contentHash: "a".repeat(64), shape }],
      },
      diagnostics: {
        schemaVersion: 1,
        documentId: snapshot.id,
        revision: snapshot.revision,
        generation: 1,
        status: "unknown",
        truncated: false,
        entries: [
          {
            entity: { kind: "feature", id: featureId },
            code: "org.vibeshape.datum-plane.support-unknown",
            values: {},
            resolution: "unknown",
            supportFeatureId: featureId,
            action: "reselect-support",
          },
        ],
      },
    }),
  })
  await fixture.host.createDraft(actor, { schemaVersion: 1, documentId, baseRevision: 2 })
  expect(
    await fixture.host.applyCommand(actor, {
      schemaVersion: 1,
      draftId,
      command: {
        kind: "org.vibeshape.document.rename",
        schemaVersion: 1,
        commandId: "0195b5ac-b222-7a2c-8c33-67a36a7f21ac",
        documentId,
        baseRevision: 2,
        issuedAt: "2026-08-08T12:00:02.000Z",
        actor,
        payload: { name: "Edited" },
      },
    }),
  ).toMatchObject({ ok: true })
  expect(await fixture.host.previewDraft(actor, { schemaVersion: 1, draftId })).toMatchObject({
    ok: true,
    value: {
      geometry: {
        status: "invalid",
        diagnostics: { status: "unknown" },
        measurements: { data: { features: [{ status: "succeeded" }] } },
      },
    },
  })
  expect(await fixture.host.commitDraft(actor, { schemaVersion: 1, draftId })).toMatchObject({
    ok: false,
    diagnostic: { code: "draft-geometry-invalid" },
  })
})

it("fails closed when complete UTF-8 draft diagnostics exceed the response budget", async () => {
  const shape = {
    valid: true,
    volume: 24000,
    surfaceArea: 5200,
    bounds: { min: [0, 0, 0], max: [20, 30, 40] },
    solidCount: 1,
    faceCount: 6,
    edgeCount: 12,
  }
  const fixture = hostFixture({
    evaluate: (snapshot) => ({
      measurements: {
        schemaVersion: 1,
        documentId: snapshot.id,
        revision: snapshot.revision,
        generation: 1,
        features: [{ featureId, status: "succeeded", contentHash: "a".repeat(64), shape }],
      },
      diagnostics: {
        schemaVersion: 1,
        documentId: snapshot.id,
        revision: snapshot.revision,
        generation: 1,
        status: "invalid",
        truncated: false,
        entries: [
          {
            entity: { kind: "feature", id: featureId },
            code: "org.vibeshape.feature.geometry-evaluation-failed",
            values: { reason: "🔧".repeat(40000) },
            action: "inspect-feature",
          },
        ],
      },
    }),
  })
  await fixture.host.createDraft(actor, { schemaVersion: 1, documentId, baseRevision: 2 })
  expect(await fixture.host.previewDraft(actor, { schemaVersion: 1, draftId })).toMatchObject({
    ok: false,
    diagnostic: { code: "query-result-too-large" },
  })
})
