import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { moduleIdSchema } from "@vibeshape/domain/identifiers"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import { describe, expect, it } from "vitest"
import {
  createQueryDispatcher,
  documentCoreQueryHandlers,
  documentSummaryViewSchema,
  queryDocumentSummary,
  type TrustedQueryHandler,
} from "./queries"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const otherDocumentId = "0195b5ac-b214-7a2c-8c33-67a36a7f21ac"

const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: documentId,
  revision: 2,
  name: "Printer enclosure",
  createdAt: "2026-08-08T12:00:00Z",
  updatedAt: "2026-08-08T12:05:00Z",
})

function query(overrides: Record<string, unknown> = {}) {
  return {
    kind: "org.vibeshape.document.summary",
    schemaVersion: 1,
    documentId,
    revision: 2,
    ...overrides,
  }
}

function moduleRegistry() {
  const result = createModuleRegistry([documentCoreModule])

  if (!result.ok) {
    throw new Error(result.diagnostic.message)
  }

  return result.registry
}

function queryDispatcher() {
  const result = createQueryDispatcher(moduleRegistry(), documentCoreQueryHandlers)

  if (!result.ok) {
    throw new Error(result.diagnostic.message)
  }

  return result.dispatcher
}

describe("document summary query", () => {
  it("returns a bounded semantic view tagged with the requested revision", () => {
    const result = queryDocumentSummary(snapshot, query())

    expect(result).toEqual({
      ok: true,
      view: {
        kind: "org.vibeshape.document.summary",
        schemaVersion: 1,
        documentId,
        revision: 2,
        classification: "semantic",
        truncated: false,
        data: {
          name: "Printer enclosure",
          createdAt: "2026-08-08T12:00:00Z",
          updatedAt: "2026-08-08T12:05:00Z",
        },
      },
    })

    if (result.ok) {
      expect(documentSummaryViewSchema.safeParse(result.view).success).toBe(true)
      expect(Object.keys(result.view).sort()).toEqual([
        "classification",
        "data",
        "documentId",
        "kind",
        "revision",
        "schemaVersion",
        "truncated",
      ])
    }
  })

  it.each([
    null,
    {},
    query({ documentId: "not-a-document-id" }),
    query({ revision: Number.POSITIVE_INFINITY }),
    { ...query(), hiddenState: true },
  ])("rejects malformed or open-ended inputs", (input) => {
    expect(queryDocumentSummary(snapshot, input)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-query" },
    })
  })

  it("rejects missing, mismatched, and stale documents", () => {
    expect(queryDocumentSummary(null, query())).toMatchObject({
      ok: false,
      diagnostic: { code: "document-not-found" },
    })
    expect(queryDocumentSummary(snapshot, query({ documentId: otherDocumentId }))).toMatchObject({
      ok: false,
      diagnostic: { code: "document-id-mismatch" },
    })
    expect(queryDocumentSummary(snapshot, query({ revision: 1 }))).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision", retryable: true },
    })
  })
})

describe("trusted query dispatcher", () => {
  it("routes registered queries through the first-party handler", () => {
    expect(queryDispatcher().dispatch(snapshot, query())).toMatchObject({
      ok: true,
      view: { documentId, revision: 2, data: { name: "Printer enclosure" } },
    })
  })

  it.each([null, {}, { kind: "invalid", schemaVersion: 1 }])(
    "rejects invalid query routes before handler execution",
    (input) => {
      expect(queryDispatcher().dispatch(snapshot, input)).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-query-route" },
      })
    },
  )

  it("rejects unregistered queries and unsupported schema versions", () => {
    expect(
      queryDispatcher().dispatch(snapshot, {
        kind: "org.example.document.unknown",
        schemaVersion: 1,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "unregistered-query" } })
    expect(queryDispatcher().dispatch(snapshot, query({ schemaVersion: 2 }))).toMatchObject({
      ok: false,
      diagnostic: { code: "unsupported-query-version" },
    })
  })

  it("preserves strict query validation behind routing", () => {
    expect(queryDispatcher().dispatch(snapshot, { ...query(), hiddenState: true })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-query" },
    })
  })

  it("requires exactly one trusted handler for every query descriptor", () => {
    const handler = documentCoreQueryHandlers[0]

    if (!handler) {
      throw new Error("The document module must expose a query handler fixture.")
    }

    expect(createQueryDispatcher(moduleRegistry(), [])).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-query-handler" },
    })
    expect(createQueryDispatcher(moduleRegistry(), [handler, handler])).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-query-handler" },
    })
  })

  it("rejects orphaned handlers and descriptor metadata drift", () => {
    const base = documentCoreQueryHandlers[0]

    if (!base) {
      throw new Error("The document module must expose a query handler fixture.")
    }

    const orphan: TrustedQueryHandler = { ...base, kind: "org.example.document.unknown" }
    const wrongOwner: TrustedQueryHandler = {
      ...base,
      ownerModuleId: moduleIdSchema.parse("org.example.document"),
    }
    const wrongVersion: TrustedQueryHandler = { ...base, schemaVersion: 2 }

    expect(createQueryDispatcher(moduleRegistry(), [orphan])).toMatchObject({
      ok: false,
      diagnostic: { code: "orphan-query-handler" },
    })
    expect(createQueryDispatcher(moduleRegistry(), [wrongOwner])).toMatchObject({
      ok: false,
      diagnostic: { code: "query-handler-owner-mismatch" },
    })
    expect(createQueryDispatcher(moduleRegistry(), [wrongVersion])).toMatchObject({
      ok: false,
      diagnostic: { code: "query-handler-version-mismatch" },
    })
  })
})
