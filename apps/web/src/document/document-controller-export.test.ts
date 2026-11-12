import "../../../../tests/unit/support/dom"

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { runtimeProjection } from "@vibeshape/application/authority-persistence-operations"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  createLengthQuantity,
  type DocumentSnapshot,
  documentSnapshotV4Schema,
  emptyAssemblyAuthority,
} from "@vibeshape/domain"
import { vi } from "../../../../tests/unit/support/bun-test"
import { extrusionBodyFixture } from "../features/extrusion/extrusion-body-test-fixtures"

const ports = {
  createSession: vi.fn(),
  createAutomation: vi.fn(),
  createHistory: vi.fn(),
}
const sessions = { ...(await import("@vibeshape/application/persistent-document-session")) }
mock.module("@vibeshape/application/persistent-document-session", () => ({
  ...sessions,
  createPersistentDocumentSession: ports.createSession,
}))
const authored = { ...(await import("./authored-document-session")) }
mock.module("./authored-document-session", () => ({
  ...authored,
  enableAuthoredDocument: (result: unknown) => result,
}))
mock.module("./browser-project-repository", () => ({
  BrowserProjectRepository: class {
    legacy = {}
    versioned = {}
    materializeSourceAssets = vi.fn()
    materializeCapturedSourceAssets = vi.fn()
  },
}))
mock.module("../automation/document-automation-session", () => ({
  createDocumentAutomationSession: ports.createAutomation,
}))
mock.module("../automation/history-automation-session", () => ({
  createBrowserHistoryAutomationSession: ports.createHistory,
}))
const { createDocumentControllerRuntime } = await import("./document-controller-runtime")
type Runtime = ReturnType<typeof createDocumentControllerRuntime>
const runtimes: Runtime[] = []

const actor = {
  type: "mcp",
  clientId: "org.example.client",
  sessionId: "0195b5ac-b250-7a2c-8c33-000000000009",
}

beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset()
  ports.createAutomation.mockImplementation(() => ({
    ok: true,
    host: {},
    dispose: vi.fn(),
    cancel: vi.fn(),
    enableAutoApply: vi.fn(),
    disableAutoApply: vi.fn(),
  }))
  ports.createHistory.mockImplementation(() => ({ cancel: vi.fn(), dispose: vi.fn() }))
})
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.closeRuntime()
})

/** A ready runtime over one extrusion whose committed rebuild succeeded or failed. */
async function fixture(rebuilt = true) {
  const seed = extrusionBodyFixture(undefined, true)
  if (!seed.rebuild.ok) throw new Error("Expected exact baseline geometry.")
  const authority = documentSnapshotV4Schema.parse({
    ...seed.snapshot,
    schemaVersion: 4,
    features: seed.snapshot.features.map((feature) => ({
      ...feature,
      schemaVersion: 1,
      semanticInputs: [],
      parameters: {
        width: createLengthQuantity(1),
        depth: createLengthQuantity(1),
        height: createLengthQuantity(1),
        centered: false,
      },
    })),
    history: seed.snapshot.features.map((feature) => ({ kind: "feature", id: feature.id })),
    parts: seed.snapshot.features.map((feature) => ({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-000000000201",
      name: "Baseline body",
      visible: true,
      origin: "independent",
      consumedBy: null,
      bodyHistory: [{ schemaVersion: 0, featureId: feature.id, outputRole: "result" }],
    })),
    folders: [],
    surfaceTextures: [],
    assets: [],
    assembly: emptyAssemblyAuthority(),
  })
  const projected = runtimeProjection(authority)
  if (!projected.ok) throw new Error("Expected a runtime projection.")
  let snapshot: DocumentSnapshot = projected.snapshot
  const rebuild: DocumentRebuildOutcome = rebuilt
    ? {
        ok: true,
        response: {
          ...seed.rebuild.response,
          documentId: snapshot.id,
          revision: snapshot.revision,
        },
      }
    : {
        ok: false,
        diagnostic: {
          code: "rebuild-failed",
          message: "The committed document could not be rebuilt.",
          retryable: true,
          sourceCode: null,
        },
      }
  const exportDocument = vi.fn(async () => ({
    ok: true as const,
    response: {
      revision: snapshot.revision,
      format: "step" as const,
      file: new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;\n"),
      bodyCount: 1,
    },
  }))
  const active = {
    get snapshot() {
      return snapshot
    },
    get authoredSnapshot() {
      return authority
    },
    history: { canUndo: false, canRedo: false },
    mode: "read-write",
    historyItems: null,
    hasPendingOperations: false,
    exportDocument,
    close: vi.fn(async () => ({ ok: true })),
  }
  ports.createSession.mockResolvedValue({
    ok: true,
    session: active,
    report: {
      status: "clean",
      snapshot,
      mode: "read-write",
      historyItems: null,
      rebuild,
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: null,
    },
  })
  const runtime = createDocumentControllerRuntime({
    initialProject: { documentId: snapshot.id, create: true },
  })
  runtimes.push(runtime)
  await runtime.startDocumentController("Export currency")
  expect(runtime.getDocumentControllerState().status).toBe("ready")
  return {
    runtime,
    exportDocument,
    get revision() {
      return snapshot.revision
    },
    /** Commits a revision the report has not caught up with yet. */
    advance() {
      snapshot = { ...snapshot, revision: snapshot.revision + 1 }
    },
    prepareModelExport(revision: number) {
      const handle = runtime.createActiveDocumentAutomationSession()
      if (!handle.ok) throw new Error("Expected an automation handle.")
      return handle.exports.execute(actor, {
        tool: "prepare_model_export",
        arguments: { revision, format: "step" },
      })
    },
  }
}

describe("model export currency through the runtime", () => {
  it("exports the current committed revision through the editor and MCP", async () => {
    const f = await fixture()
    expect(await f.runtime.exportActiveDocument("step")).toMatchObject({ ok: true, format: "step" })
    expect(await f.prepareModelExport(f.revision)).toMatchObject({ ok: true })
  })

  it("reports a failed rebuild as final without exporting an earlier rebuild", async () => {
    const f = await fixture(false)
    expect(await f.runtime.exportActiveDocument("step")).toMatchObject({
      ok: false,
      diagnostic: { retryable: false, sourceCode: "rebuild-failed" },
    })
    expect(await f.prepareModelExport(f.revision)).toMatchObject({
      ok: false,
      diagnostic: { code: "rebuild-failed", retryable: false },
    })
    expect(f.exportDocument).not.toHaveBeenCalled()
  })

  it("refuses a report that lags the committed revision", async () => {
    const f = await fixture()
    f.advance()
    expect(await f.runtime.exportActiveDocument("step")).toMatchObject({
      ok: false,
      diagnostic: { retryable: true, sourceCode: "stale-revision" },
    })
    expect(await f.prepareModelExport(f.revision)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision", retryable: true },
    })
    expect(f.exportDocument).not.toHaveBeenCalled()
  })

  it("discards an export finished after its runtime closed", async () => {
    const f = await fixture()
    f.exportDocument.mockImplementationOnce(async () => {
      await f.runtime.closeRuntime()
      return {
        ok: true as const,
        response: {
          revision: f.revision,
          format: "step" as const,
          file: new Uint8Array([1]),
          bodyCount: 1,
        },
      }
    })
    expect(await f.runtime.exportActiveDocument("step")).toMatchObject({
      ok: false,
      diagnostic: { retryable: true, sourceCode: "stale-revision" },
    })
  })
})
