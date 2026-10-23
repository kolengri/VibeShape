import { describe, expect, it, mock } from "bun:test"
import { DOCUMENT_PROTOCOL_VERSION, type InspectAssemblyInput } from "@vibeshape/protocol"
import { AssemblyInspectionSession } from "./assembly-inspection-session"

const input: InspectAssemblyInput = {
  authorityJson: "{}",
  sourceAssets: [],
  mesh: { chordTolerance: 0.1, angularTolerance: 0.1 },
  interferencePairs: [],
}
const documentId = "0195b5ac-b220-7a2c-8c33-000000000001"
const response = {
  protocolVersion: DOCUMENT_PROTOCOL_VERSION,
  requestId: "inspection",
  documentId,
  revision: 3,
  generation: 1,
  type: "assemblyInspected" as const,
  inspection: { occurrences: [], interference: [] },
}
function fixture() {
  const worker = {
    inspectAssembly: mock(async () => response),
    terminate: mock(() => {}),
  }
  const factory = mock(() => worker)
  return { worker, factory, session: new AssemblyInspectionSession(factory) }
}

describe("assembly inspection worker ownership", () => {
  it("reuses one worker across poses and replaces it at a revision or project boundary", async () => {
    const { session, factory, worker } = fixture()
    await session.inspect(documentId, 3, input)
    await session.inspect(documentId, 3, { ...input, authorityJson: '{"pose":1}' })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(worker.inspectAssembly).toHaveBeenCalledTimes(2)
    expect(worker.terminate).not.toHaveBeenCalled()
    session.retain({ id: documentId, revision: 4 })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    await session.inspect(documentId, 4, input)
    expect(factory).toHaveBeenCalledTimes(2)
    session.retain(null)
    expect(worker.terminate).toHaveBeenCalledTimes(2)
  })

  it("releases completed abort listeners and replaces a cancelled worker before retry", async () => {
    const { session, factory, worker } = fixture()
    const completed = new AbortController()
    await session.inspect(documentId, 3, input, completed.signal)
    completed.abort()
    expect(worker.terminate).not.toHaveBeenCalled()
    let reject!: (error: Error) => void
    worker.inspectAssembly.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        }),
    )
    worker.terminate.mockImplementation(() => reject(new Error("Worker terminated")))
    const active = new AbortController()
    const operation = session.inspect(documentId, 3, input, active.signal)
    await Promise.resolve()
    active.abort()
    await expect(operation).rejects.toThrow("Worker terminated")
    await session.inspect(documentId, 3, input)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("cancels queued work without terminating an active request", async () => {
    const { session, worker } = fixture()
    let finish!: (value: typeof response) => void
    worker.inspectAssembly.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const active = session.inspect(documentId, 3, input)
    await Promise.resolve()
    const abort = new AbortController()
    const queued = session.inspect(documentId, 3, input, abort.signal)
    abort.abort()
    expect(worker.terminate).not.toHaveBeenCalled()
    finish(response)
    await active
    await expect(queued).rejects.toThrow("cancelled")
    expect(worker.inspectAssembly).toHaveBeenCalledTimes(1)
  })

  it("rejects queued receipts after leaving and reopening the same revision", async () => {
    const { session, factory } = fixture()
    const stale = session.inspect(documentId, 3, input)
    session.retain(null)
    session.retain({ id: documentId, revision: 3 })
    await expect(stale).rejects.toThrow("cancelled")
    expect(factory).not.toHaveBeenCalled()
  })

  it("discards a failed worker so the next inspection can retry", async () => {
    const { session, factory, worker } = fixture()
    worker.inspectAssembly.mockRejectedValueOnce(new Error("Worker failed"))
    await expect(session.inspect(documentId, 3, input)).rejects.toThrow("Worker failed")
    await session.inspect(documentId, 3, input)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})
