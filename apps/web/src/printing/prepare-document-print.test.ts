import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { DocumentExportOptions } from "@vibeshape/protocol"
import { vi } from "../../../../tests/unit/support/bun-test"
import { printExportWorkerFailure } from "./print-export-error.test-fixture"

const worker = (() => ({ rebuild: vi.fn(), exportDocument: vi.fn(), terminate: vi.fn() }))()
mock.module("@vibeshape/document-worker/session", () => ({
  createDocumentWorkerSession: () => worker,
}))

const { documentSnapshotSchema } = await import("@vibeshape/domain")
const { DEFAULT_SURFACE_TEXTURE_QUALITY, printPreparationSettingsSchema } = await import(
  "@vibeshape/protocol"
)
const { prepareDocumentPrint } = await import("./prepare-document-print")
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
  revision: 1,
  name: "Source model",
  features: [],
  variables: [],
  sketches: [],
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
})
const settings = printPreparationSettingsSchema.parse({})
beforeEach(() => {
  vi.resetAllMocks()
  worker.rebuild.mockResolvedValue({})
  worker.exportDocument.mockResolvedValue({
    format: "3mf",
    file: new Uint8Array([80, 75]),
    bodyCount: 1,
  })
})
describe("disposable print worker lifecycle", () => {
  for (const stage of ["rebuild", "exportDocument"] as const) {
    it(`retains validated worker evidence when ${stage} fails`, async () => {
      worker[stage].mockRejectedValueOnce(printExportWorkerFailure())
      const result = await prepareDocumentPrint(
        snapshot,
        settings,
        new AbortController().signal,
        () => true,
      )
      expect(result).toEqual({
        ok: false,
        diagnostic: {
          code: "export-failed",
          sourceCode: "export-failed",
          retryable: false,
          message: "Body Lid contains a degenerate triangle.",
        },
      })
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    })
  }
  it.each([
    new Error("Unvalidated private worker details"),
    {
      response: { type: "failure", diagnostic: { message: "Unvalidated private worker details" } },
    },
  ])(
    "uses the generic fallback when an exception has no validated worker envelope",
    async (error) => {
      worker.exportDocument.mockRejectedValueOnce(error)
      expect(
        await prepareDocumentPrint(snapshot, settings, new AbortController().signal, () => true),
      ).toEqual({
        ok: false,
        diagnostic: {
          code: "export-failed",
          sourceCode: null,
          retryable: true,
          message: "The print copy could not be prepared.",
        },
      })
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    },
  )
  it("does not attach stale worker evidence after the source changes", async () => {
    let current = true
    worker.exportDocument.mockImplementationOnce(async () => {
      current = false
      throw printExportWorkerFailure()
    })
    expect(
      await prepareDocumentPrint(snapshot, settings, new AbortController().signal, () => current),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        sourceCode: null,
        message: "Print preparation was canceled or its source changed.",
      },
    })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
  it("keeps abort semantics when a terminated export also carries a validated failure", async () => {
    const abort = new AbortController()
    worker.exportDocument.mockImplementationOnce(async () => {
      abort.abort()
      throw printExportWorkerFailure()
    })
    expect(await prepareDocumentPrint(snapshot, settings, abort.signal, () => true)).toMatchObject({
      ok: false,
      diagnostic: {
        sourceCode: null,
        message: "Print preparation was canceled or its source changed.",
      },
    })
    expect(worker.terminate).toHaveBeenCalled()
  })
  it("terminates its worker after export and keeps the captured document name", async () => {
    const result = await prepareDocumentPrint(
      snapshot,
      settings,
      new AbortController().signal,
      () => true,
    )
    expect(result).toMatchObject({ ok: true, documentName: "Source model" })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
  it("rejects a result whose source changed during export", async () => {
    let current = true
    worker.exportDocument.mockImplementation(async () => {
      current = false
      return { format: "3mf", file: new Uint8Array([1]), bodyCount: 1 }
    })
    expect(
      await prepareDocumentPrint(snapshot, settings, new AbortController().signal, () => current),
    ).toMatchObject({ ok: false })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
  it("prepares only the captured terminal bodies and their texture groups", async () => {
    const options: DocumentExportOptions = {
      bodies: [{ featureId: "0195b5ac-b220-7a2c-8c33-000000000001", outputRole: "result" }],
      surfaceTextures: [],
      meshQuality: { chordTolerance: 0.01, angularTolerance: 0.05 },
    }
    await prepareDocumentPrint(
      snapshot,
      settings,
      new AbortController().signal,
      () => true,
      options,
    )
    expect(worker.exportDocument).toHaveBeenCalledWith("3mf", {
      ...options,
      printPreparation: settings,
      textureQuality: DEFAULT_SURFACE_TEXTURE_QUALITY,
    })
  })
  it("terminates in-flight work on abort without replay or export", async () => {
    const abort = new AbortController()
    worker.rebuild.mockImplementation(
      () =>
        new Promise((_, reject) =>
          worker.terminate.mockImplementation(() => reject(new Error("terminated"))),
        ),
    )
    const pending = prepareDocumentPrint(snapshot, settings, abort.signal, () => true)
    abort.abort()
    expect(await pending).toMatchObject({ ok: false })
    expect(worker.terminate).toHaveBeenCalled()
    expect(worker.exportDocument).not.toHaveBeenCalled()
  })
  it("does not start canceled work", async () => {
    const abort = new AbortController()
    abort.abort()
    expect(await prepareDocumentPrint(snapshot, settings, abort.signal, () => true)).toMatchObject({
      ok: false,
    })
    expect(worker.rebuild).not.toHaveBeenCalled()
  })
})
