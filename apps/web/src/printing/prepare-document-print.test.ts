import { documentSnapshotSchema } from "@vibeshape/domain"
import { printPreparationSettingsSchema } from "@vibeshape/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prepareDocumentPrint } from "./prepare-document-print"

const worker = vi.hoisted(() => ({ rebuild: vi.fn(), exportDocument: vi.fn(), terminate: vi.fn() }))
vi.mock("@vibeshape/document-worker/session", () => ({ createDocumentWorkerSession: () => worker }))
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
  it("terminates its worker after export and keeps the captured document name", async () => {
    const result = await prepareDocumentPrint(
      snapshot,
      settings,
      new AbortController().signal,
      () => true,
    )
    expect(result).toMatchObject({ ok: true, documentName: "Source model" })
    expect(worker.terminate).toHaveBeenCalledOnce()
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
    expect(worker.terminate).toHaveBeenCalledOnce()
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
