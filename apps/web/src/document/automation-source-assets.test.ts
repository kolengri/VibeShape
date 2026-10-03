// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createActiveDocumentAutomationSession,
  materializeActiveDocumentSourceAssets,
  useDocumentController,
} from "./document-controller"

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  createAutomation: vi.fn(),
  materialize: vi.fn(),
}))
vi.mock("@vibeshape/application/persistent-document-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vibeshape/application/persistent-document-session")>()),
  createPersistentDocumentSession: mocks.createSession,
}))
vi.mock("./authored-document-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./authored-document-session")>()),
  enableAuthoredDocument: (result: unknown) => result,
}))
vi.mock("./browser-project-repository", () => ({
  BrowserProjectRepository: class {
    legacy = {}
    versioned = {}
    materializeSourceAssets = mocks.materialize
  },
}))
vi.mock("../automation/document-automation-session", () => ({
  createDocumentAutomationSession: mocks.createAutomation,
}))

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const document = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: id(1),
  revision: 3,
  name: "Source asset boundary",
  variables: [],
  sketches: [],
  features: [],
  createdAt: "2026-10-03T00:00:00.000Z",
  updatedAt: "2026-10-03T00:00:00.000Z",
})
const active = { snapshot: document }

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

async function pairedMaterializer() {
  const handle = createActiveDocumentAutomationSession()
  if (!handle.ok) throw new Error("Expected an active automation handle.")
  const configuration = mocks.createAutomation.mock.lastCall?.[0] as {
    materializeSourceAssets(input: unknown): Promise<unknown>
  }
  return { handle, materialize: configuration.materializeSourceAssets }
}

describe("paired draft source materialization", () => {
  beforeAll(async () => {
    vi.stubGlobal("localStorage", storage())
    vi.stubGlobal("sessionStorage", storage())
    mocks.createSession.mockResolvedValue({
      ok: true,
      session: active,
      report: { snapshot: document, writeAccessDiagnostic: null, mode: "writer" },
    })
    mocks.createAutomation.mockImplementation(() => ({
      ok: true,
      host: {},
      dispose: vi.fn(),
      cancel: vi.fn(),
      enableAutoApply: vi.fn(),
    }))
    const controller = renderHook(() => useDocumentController("Source asset boundary"))
    await waitFor(() => expect(controller.result.current.status).toBe("ready"))
    controller.unmount()
  })
  beforeEach(() => {
    active.snapshot = document
    mocks.materialize.mockReset().mockResolvedValue([])
  })

  it("materializes the paired source for a private draft revision without relaxing committed reads", async () => {
    const paired = await pairedMaterializer()
    const draft = { ...document, revision: 9 }
    try {
      await expect(paired.materialize(draft)).resolves.toEqual([])
      expect(mocks.materialize).toHaveBeenCalledExactlyOnceWith(document.id, draft.features)
      await expect(materializeActiveDocumentSourceAssets(draft)).rejects.toThrow("revision changed")
      await expect(materializeActiveDocumentSourceAssets(document)).resolves.toEqual([])
    } finally {
      paired.handle.dispose()
    }
  })

  it("rejects another document and a disposed pairing before any source read", async () => {
    const paired = await pairedMaterializer()
    await expect(paired.materialize({ ...document, id: id(2), revision: 9 })).rejects.toThrow(
      "unavailable",
    )
    paired.handle.dispose()
    await expect(paired.materialize({ ...document, revision: 9 })).rejects.toThrow("unavailable")
    expect(mocks.materialize).not.toHaveBeenCalled()
  })

  it.each(["revision", "document", "closed"] as const)(
    "rejects %s changes across asynchronous source materialization",
    async (change) => {
      let finish: (value: never[]) => void = () => {
        throw new Error("Expected pending read.")
      }
      mocks.materialize.mockImplementation(
        () =>
          new Promise<never[]>((resolve) => {
            finish = resolve
          }),
      )
      const paired = await pairedMaterializer()
      const pending = paired.materialize({ ...document, revision: 9 })
      if (change === "closed") paired.handle.dispose()
      else
        active.snapshot = documentSnapshotSchema.parse({
          ...document,
          ...(change === "revision" ? { revision: 4 } : { id: id(2) }),
        })
      finish([])
      await expect(pending).rejects.toThrow("changed during materialization")
      paired.handle.dispose()
    },
  )
})
