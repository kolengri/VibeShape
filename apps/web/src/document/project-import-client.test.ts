import { afterEach, expect, it } from "bun:test"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { VibeShapeDatabase } from "@vibeshape/persistence"
import { vi } from "../../../../tests/unit/support/bun-test"
import { BrowserProjectRepository } from "./browser-project-repository"
import { prepareProjectDuplicate, prepareProjectImport } from "./project-import-client"

afterEach(() => vi.useRealTimers())

const documentId = documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000101")
function input() {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    documentId,
    issuedAt: "2026-10-19T00:00:00.000Z",
    resolveName: vi.fn((name: string) => `${name} copy`),
    signal: new AbortController().signal,
  }
}
function port() {
  return {
    terminate: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null as Worker["onmessage"],
    onerror: null as Worker["onerror"],
    onmessageerror: null as Worker["onmessageerror"],
  }
}
function deliver(worker: ReturnType<typeof port>, data: object) {
  const decode = worker.postMessage.mock.calls[0]?.[0]
  worker.onmessage?.call(
    worker as unknown as Worker,
    new MessageEvent("message", {
      data: { schemaVersion: 0, jobId: decode.jobId, ...data },
    }),
  )
}
const prepared = () => ({
  kind: "prepared",
  value: {
    version: 2 as const,
    project: {
      snapshot: { id: documentId, revision: 2, name: "Housing copy" },
      historyMode: "complete",
    },
  },
})

function duplicateInput() {
  return {
    databaseName: "project-copy-test",
    sourceDocumentId: documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000201"),
    expectedHeadRevision: 12,
    documentId,
    name: "Housing copy",
    issuedAt: "2026-10-24T12:00:00.000Z",
    signal: new AbortController().signal,
  }
}

it("prepares a saved copy using only database and revision metadata in one worker round trip", async () => {
  const worker = port()
  const input = duplicateInput()
  const pending = prepareProjectDuplicate(input, () => worker as unknown as Worker)
  expect(worker.postMessage).toHaveBeenCalledTimes(1)
  const request = worker.postMessage.mock.calls[0]?.[0]
  expect(request).toEqual({
    schemaVersion: 0,
    jobId: expect.any(String),
    kind: "duplicate",
    databaseName: input.databaseName,
    sourceDocumentId: input.sourceDocumentId,
    expectedHeadRevision: 12,
    documentId,
    name: "Housing copy",
    issuedAt: input.issuedAt,
  })
  deliver(worker, prepared())
  expect(await pending).toEqual({ ok: true, value: prepared().value })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it("rejects an unexpected naming phase for a saved copy", async () => {
  const worker = port()
  const pending = prepareProjectDuplicate(duplicateInput(), () => worker as unknown as Worker)
  deliver(worker, { kind: "name", sourceName: "Housing" })
  await expect(pending).rejects.toThrow("naming phase")
  expect(worker.postMessage).toHaveBeenCalledTimes(1)
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it.each(["before", "during", "construction"] as const)(
  "releases saved-copy preparation on cancellation %s worker setup",
  async (phase) => {
    const worker = port()
    const abort = new AbortController()
    const create = vi.fn(() => {
      if (phase === "construction") abort.abort()
      return worker as unknown as Worker
    })
    if (phase === "before") abort.abort()
    const pending = prepareProjectDuplicate({ ...duplicateInput(), signal: abort.signal }, create)
    const late = worker.onmessage
    if (phase === "during") abort.abort()
    late?.call(worker as unknown as Worker, new MessageEvent("message", { data: prepared() }))
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(worker.terminate).toHaveBeenCalledTimes(phase === "before" ? 0 : 1)
    expect(worker.postMessage).toHaveBeenCalledTimes(phase === "during" ? 1 : 0)
  },
)

it("transfers an owned input copy and resolves the name once without exposing the journal", async () => {
  const worker = port()
  worker.postMessage.mockImplementation((value, transfer) => structuredClone(value, { transfer }))
  const request = input()
  const pending = prepareProjectImport(request, () => worker as unknown as Worker)
  expect(request.bytes).toEqual(new Uint8Array([1, 2, 3]))
  expect(worker.postMessage.mock.calls[0]?.[0].bytes.byteLength).toBe(0)
  deliver(worker, { kind: "name", sourceName: "Housing" })
  expect(request.resolveName).toHaveBeenCalledTimes(1)
  expect(request.resolveName).toHaveBeenCalledWith("Housing")
  expect(worker.postMessage.mock.calls[1]?.[0]).toMatchObject({
    kind: "copy",
    name: "Housing copy",
    documentId,
  })
  deliver(worker, prepared())
  expect(await pending).toEqual({ ok: true, value: prepared().value })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.onmessage).toBeNull()
})

it("rejects malformed, out-of-order, duplicate, foreign-job, and wrong-identity responses", async () => {
  for (const response of [
    { kind: "name", sourceName: null },
    { kind: "name", sourceName: "Housing", schemaVersion: 1 },
    { kind: "error", diagnostic: { code: 0, message: "Invalid diagnostic." } },
    { ...prepared(), jobId: crypto.randomUUID() },
    { ...prepared(), value: { version: 8, project: {} } },
    { ...prepared(), value: { version: 2, project: null } },
    {
      ...prepared(),
      value: {
        version: 2,
        project: {
          snapshot: { id: documentId, revision: 0, name: "Housing copy" },
          historyMode: "complete",
        },
      },
    },
    {
      ...prepared(),
      value: {
        version: 2,
        project: {
          snapshot: { id: crypto.randomUUID(), revision: 1, name: "Housing copy" },
          historyMode: "complete",
        },
      },
    },
    {
      ...prepared(),
      value: {
        version: 2,
        project: {
          snapshot: { id: documentId, revision: 1, name: "Wrong" },
          historyMode: "complete",
        },
      },
    },
    { kind: "name", sourceName: "Repeated" },
  ]) {
    const worker = port()
    const pending = prepareProjectImport(input(), () => worker as unknown as Worker)
    deliver(worker, { kind: "name", sourceName: "Housing" })
    deliver(worker, response)
    await expect(pending).rejects.toThrow()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  }
  const worker = port()
  const pending = prepareProjectImport(input(), () => worker as unknown as Worker)
  deliver(worker, prepared())
  await expect(pending).rejects.toThrow()
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it("preserves format diagnostics and cleans up after naming and transport errors", async () => {
  const worker = port()
  const pending = prepareProjectImport(input(), () => worker as unknown as Worker)
  deliver(worker, {
    kind: "error",
    diagnostic: { code: "unsupported-version", message: "Newer reader required." },
  })
  expect(await pending).toEqual({
    ok: false,
    diagnostic: { code: "unsupported-version", message: "Newer reader required." },
  })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  for (const failure of ["callback", "post", "onerror", "onmessageerror"] as const) {
    const worker = port()
    const request = input()
    if (failure === "callback")
      request.resolveName.mockImplementation(() => {
        throw new Error("Naming failed.")
      })
    if (failure === "post")
      worker.postMessage.mockImplementation(() => {
        throw new Error("Posting failed.")
      })
    const pending = prepareProjectImport(request, () => worker as unknown as Worker)
    if (failure === "callback") deliver(worker, { kind: "name", sourceName: "Housing" })
    if (failure === "onerror" || failure === "onmessageerror")
      worker[failure]?.call(
        worker as unknown as Worker,
        new Event("error") as ErrorEvent & MessageEvent,
      )
    await expect(pending).rejects.toThrow()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  }
})

it("aborts before startup and during either phase, ignoring queued completions", async () => {
  for (const phase of ["before", "decode", "copy", "callback"] as const) {
    const abort = new AbortController()
    const request = { ...input(), signal: abort.signal }
    const worker = port()
    const create = vi.fn(() => worker as unknown as Worker)
    if (phase === "before") abort.abort()
    if (phase === "callback")
      request.resolveName.mockImplementation(() => {
        abort.abort()
        return "Housing copy"
      })
    const pending = prepareProjectImport(request, create)
    const queued = worker.onmessage
    if (phase === "copy" || phase === "callback")
      deliver(worker, { kind: "name", sourceName: "Housing" })
    abort.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    queued?.call(worker as unknown as Worker, new MessageEvent("message", { data: prepared() }))
    expect(request.bytes.byteLength).toBe(3)
    expect(worker.terminate).toHaveBeenCalledTimes(phase === "before" ? 0 : 1)
    expect(create).toHaveBeenCalledTimes(phase === "before" ? 0 : 1)
    if (phase === "callback") expect(worker.postMessage).toHaveBeenCalledTimes(1)
  }
})

it("releases worker resources on timeout and constructor failure", async () => {
  await expect(
    prepareProjectImport(input(), () => {
      throw new Error("Unavailable.")
    }),
  ).rejects.toThrow("Unavailable.")
  vi.useFakeTimers()
  const worker = port()
  const outcome = prepareProjectImport(input(), () => worker as unknown as Worker).catch(
    (error: unknown) => error,
  )
  vi.advanceTimersByTime(300_000)
  expect(await outcome).toBeInstanceOf(Error)
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it("forwards archives above the former 32 MiB ceiling to worker validation", async () => {
  const worker = port()
  const create = vi.fn(() => worker as unknown as Worker)
  const bytes = new Uint8Array(32 * 1024 * 1024 + 1)
  bytes[bytes.length - 1] = 23
  const pending = prepareProjectImport({ ...input(), bytes }, create)
  expect(create).toHaveBeenCalledTimes(1)
  const request = worker.postMessage.mock.calls[0]?.[0]
  expect(request.kind).toBe("decode")
  expect(request.bytes).not.toBe(bytes)
  expect(request.bytes.byteLength).toBe(33_554_433)
  expect(request.bytes.at(-1)).toBe(23)
  deliver(worker, { kind: "name", sourceName: "Housing" })
  deliver(worker, prepared())
  expect(await pending).toEqual({ ok: true, value: prepared().value })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it("keeps opaque worker data untrusted until repository validation, before any transaction", async () => {
  const database = new VibeShapeDatabase("invalid-prepared-project")
  const transaction = vi.spyOn(database, "transaction")
  const repository = new BrowserProjectRepository(database)
  try {
    for (const version of [2, 3, 4, 5, 6, 7] as const) {
      const worker = port()
      const request = input()
      const pending = prepareProjectImport(request, () => worker as unknown as Worker)
      deliver(worker, { kind: "name", sourceName: "Housing" })
      deliver(worker, { ...prepared(), value: { ...prepared().value, version } })
      const result = await pending
      if (!result.ok) throw new Error(result.diagnostic.message)
      expect(await repository.copyPortableProject(result.value, request.issuedAt)).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-input" },
      })
    }
    expect(transaction).not.toHaveBeenCalled()
  } finally {
    transaction.mockRestore()
    database.close()
  }
})
