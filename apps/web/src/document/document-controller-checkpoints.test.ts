import "../../../../tests/unit/support/dom"

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { runtimeProjection } from "@vibeshape/application/authority-persistence-operations"
import type {
  DocumentHistoryPreview,
  DocumentRebuildOutcome,
} from "@vibeshape/application/persistent-document-session"
import {
  assemblyRigidPoseSchema,
  captureAssemblyDefinition,
  createLengthQuantity,
  type DocumentSnapshot,
  documentSnapshotV4Schema,
  emptyAssemblyAuthority,
} from "@vibeshape/domain"
import { applyDocumentCommand, type DocumentCommand } from "@vibeshape/domain/commands"
import { assemblyInspectionSchema } from "@vibeshape/protocol"
import { DocumentUndoHistory } from "../../../../packages/application/src/document-undo-history"
import { vi } from "../../../../tests/unit/support/bun-test"
import { extrusionBodyFixture } from "../features/extrusion/extrusion-body-test-fixtures"

const ports = {
  createSession: vi.fn(),
  createWorker: vi.fn(),
  rebuild: vi.fn(),
  terminate: vi.fn(),
  materialize: vi.fn(),
  assemblyAssets: vi.fn(),
  inspectAssembly: vi.fn(),
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
    materializeCapturedSourceAssets = ports.materialize
    materializeAssemblySourceAssets = ports.assemblyAssets
  },
}))
mock.module("@vibeshape/document-worker/session", () => ({
  createDocumentWorkerSession: ports.createWorker,
}))
const { createDocumentControllerRuntime } = await import("./document-controller-runtime")
type Runtime = ReturnType<typeof createDocumentControllerRuntime>
const runtimes: Runtime[] = []

beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset()
  ports.materialize.mockResolvedValue([])
  ports.assemblyAssets.mockResolvedValue([])
})
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.closeRuntime()
})

function fixtureAuthority(seed: ReturnType<typeof extrusionBodyFixture>, assembly: boolean) {
  let authority = documentSnapshotV4Schema.parse({
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
  if (assembly) {
    const part = authority.parts[0]
    const body = part?.bodyHistory[0]
    const geometry = seed.rebuild.ok ? seed.rebuild.response.geometry[0]?.geometry : null
    if (!part || !body || !geometry) throw new Error("Expected an assembly source body.")
    const pose = assemblyRigidPoseSchema.parse({ translation: [8, 0, 0], quaternion: [0, 0, 0, 1] })
    const definition = captureAssemblyDefinition(authority, {
      schemaVersion: 1,
      id: "0195b5ac-b220-7a2c-8c33-000000000202",
      name: "Captured body",
      sources: [{ kind: "part", partId: part.id, body, contentHash: "a".repeat(64) }],
      sourceFrame: pose,
    })
    const instance = {
      schemaVersion: 1,
      id: "0195b5ac-b220-7a2c-8c33-000000000203",
      definitionId: definition.id,
      name: "Placed body",
      grounded: true,
      worldFrame: pose,
    }
    authority = documentSnapshotV4Schema.parse({
      ...authority,
      assembly: { ...emptyAssemblyAuthority(), definitions: [definition], instances: [instance] },
    })
    ports.inspectAssembly.mockResolvedValue({
      inspection: assemblyInspectionSchema.parse({
        occurrences: [
          {
            instanceId: instance.id,
            definitionId: definition.id,
            pinRevision: 1,
            sourceIndex: 0,
            selectedBody: body,
            contentHash: "a".repeat(64),
            representation: "exact-solid",
            geometryFrame: pose,
            mesh: geometry.mesh,
            bounds: geometry.shape.bounds,
          },
        ],
        interference: [],
      }),
    })
  }
  return authority
}

async function fixture(
  change?: (rebuild: DocumentRebuildOutcome) => DocumentRebuildOutcome,
  assembly = false,
) {
  const seed = extrusionBodyFixture(undefined, !assembly)
  let authority = fixtureAuthority(seed, assembly)
  const history = new DocumentUndoHistory<typeof authority>()
  function project(target: typeof authority) {
    const result = runtimeProjection(target)
    if (!result.ok) throw new Error("Expected a checkpoint runtime projection.")
    return result.snapshot
  }
  let snapshot: DocumentSnapshot = project(authority)
  let closed = false
  let targetOverride: ((target: DocumentHistoryPreview) => DocumentHistoryPreview) | null = null
  function rebuilt(document = snapshot): DocumentRebuildOutcome {
    if (!seed.rebuild.ok) throw new Error("Expected exact baseline geometry.")
    return {
      ok: true,
      response: { ...seed.rebuild.response, documentId: document.id, revision: document.revision },
    }
  }
  const active = {
    get snapshot() {
      return snapshot
    },
    get authoredSnapshot() {
      return authority
    },
    get history() {
      return history.availability
    },
    mode: "read-write",
    historyItems: null,
    hasPendingOperations: false,
    captureHistoryCheckpoint: (acceptsActor: Parameters<typeof history.captureCheckpoint>[1]) =>
      history.captureCheckpoint(structuredClone(authority), acceptsActor),
    readHistoryCheckpoint: (handle: Parameters<typeof history.checkpointState>[0]) =>
      closed ? null : history.checkpointState(handle, authority),
    releaseHistoryCheckpoint: (handle: Parameters<typeof history.releaseCheckpoint>[0]) =>
      history.releaseCheckpoint(handle),
    sealHistoryCheckpoint: (
      handle: Parameters<typeof history.sealCheckpoint>[0],
      revision: number,
    ) => history.sealCheckpoint(handle, authority, revision),
    previewHistoryCheckpoint(handle: Parameters<typeof history.checkpointTarget>[0]) {
      const target = history.checkpointTarget(handle, authority)
      if (!target) return null
      const preview = {
        targetRevision: target.revision,
        snapshot: project(target),
        authority: structuredClone(target),
      }
      return targetOverride?.(preview) ?? preview
    },
    async commit(command: DocumentCommand) {
      const result = applyDocumentCommand(snapshot, command)
      if (!result.ok) return result
      const next = documentSnapshotV4Schema.parse({
        ...authority,
        name: result.snapshot.name,
        revision: result.snapshot.revision,
        updatedAt: result.snapshot.updatedAt,
      })
      history.record(authority, next, [command.actor])
      authority = next
      snapshot = result.snapshot
      return { ...result, rebuild: rebuilt() }
    },
    async close() {
      closed = true
      history.clear()
      return { ok: true }
    },
  }
  const baseline = change?.(rebuilt()) ?? rebuilt()
  ports.createSession.mockResolvedValue({
    ok: true,
    session: active,
    report: {
      status: "clean",
      snapshot,
      mode: "read-write",
      historyItems: null,
      rebuild: baseline,
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: null,
    },
  })
  ports.rebuild.mockImplementation(async ({ document }: { document: DocumentSnapshot }) => {
    const result = rebuilt(document)
    if (!result.ok) throw new Error("Expected a rebuilt preview.")
    return result.response
  })
  ports.createWorker.mockImplementation(
    (
      _id: string,
      options: { materializeSourceAssets?: (document: DocumentSnapshot) => Promise<unknown> },
    ) => ({
      async rebuild(input: { document: DocumentSnapshot }) {
        await options.materializeSourceAssets?.(input.document)
        return ports.rebuild(input)
      },
      terminate: ports.terminate,
      inspectAssembly: ports.inspectAssembly,
    }),
  )
  const runtime = createDocumentControllerRuntime({
    initialProject: { documentId: snapshot.id, create: true },
  })
  runtimes.push(runtime)
  await runtime.startDocumentController("Checkpoint baseline")
  expect(runtime.getDocumentControllerState().status).toBe("ready")
  const port = runtime.createAssistantCheckpointPort()
  if (!port) throw new Error("Expected an owned checkpoint port.")
  const handle = port.capture(() => true)
  if (!handle) throw new Error("Expected a saved baseline handle.")
  await runtime.renameActiveProject(snapshot.revision, "Saved assistant result")
  expect(port.seal(handle, snapshot.revision)).toBe(true)
  return {
    runtime,
    port,
    handle,
    baseline,
    active,
    get revision() {
      return snapshot.revision
    },
    overrideTarget(value: NonNullable<typeof targetOverride>) {
      targetOverride = value
    },
  }
}

describe("assistant checkpoint baseline reuse", () => {
  it("reuses the captured validated baseline across before/current without a disposable worker", async () => {
    const f = await fixture()
    const saved = f.runtime.getDocumentControllerState().report
    expect(await f.port.viewBefore(f.handle, f.revision)).toBe(true)
    const first = f.runtime.getDocumentControllerState().assistantCheckpointPresentation
    if (!f.baseline.ok) throw new Error("Expected validated baseline geometry.")
    expect(first?.target.snapshot.name).toBe("Legacy extrusion")
    expect(first?.rebuild.revision).toBe(f.revision - 1)
    expect(first?.baseRevision).toBe(f.revision)
    expect(first?.rebuild).toEqual(f.baseline.response)
    expect(first?.rebuild).not.toBe(f.baseline.response)
    expect(f.runtime.getDocumentControllerState().report).toBe(saved)
    f.port.clearPreview()
    expect(await f.port.viewBefore(f.handle, f.revision)).toBe(true)
    expect(ports.createWorker).not.toHaveBeenCalled()
    expect(ports.materialize).not.toHaveBeenCalled()
  })

  it("owns baseline feature and body buffers independently of the active worker result", async () => {
    const f = await fixture()
    if (!f.baseline.ok) throw new Error("Expected a retained baseline.")
    const geometry = f.baseline.response.geometry[0]?.geometry
    if (!geometry) throw new Error("Expected baseline feature geometry.")
    geometry.mesh.positions.fill(123)
    for (const body of geometry.bodies ?? []) body.mesh.positions.fill(456)
    expect(await f.port.viewBefore(f.handle, f.revision)).toBe(true)
    const captured =
      f.runtime.getDocumentControllerState().assistantCheckpointPresentation?.rebuild.geometry[0]
        ?.geometry
    expect(captured?.mesh.positions[0]).toBe(0)
    expect(captured?.bodies?.[0]?.mesh.positions[0]).toBe(0)
  })

  it.each(["missing", "stale", "incomplete", "over-budget"] as const)(
    "retains the isolated worker and captured source-asset path for %s baseline evidence",
    async (kind) => {
      const f = await fixture((baseline) => {
        if (!baseline.ok) throw new Error("Expected seed geometry.")
        if (kind === "missing")
          return {
            ok: false,
            diagnostic: {
              code: "rebuild-failed",
              message: "Unavailable",
              retryable: true,
              sourceCode: null,
            },
          }
        if (kind === "over-budget")
          return {
            ok: true,
            response: {
              ...baseline.response,
              geometry: baseline.response.geometry.map((record) => ({
                ...record,
                geometry: {
                  ...record.geometry,
                  mesh: {
                    ...record.geometry.mesh,
                    positions: new Float32Array(16 * 1024 * 1024 + 1),
                  },
                },
              })),
            },
          }
        return {
          ok: true,
          response: {
            ...baseline.response,
            ...(kind === "stale" ? { revision: 0 } : { geometry: [] }),
          },
        }
      })
      expect(await f.port.viewBefore(f.handle, f.revision)).toBe(true)
      expect(ports.createWorker).toHaveBeenCalledTimes(1)
      expect(ports.materialize).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Legacy extrusion" }),
      )
      expect(ports.terminate).toHaveBeenCalledTimes(1)
    },
  )

  it.each(["snapshot", "authority"] as const)(
    "requires exact captured %s content even when document and revision match",
    async (kind) => {
      const f = await fixture()
      f.overrideTarget((target) => ({
        ...target,
        [kind]: { ...target[kind], name: "Different captured content" },
      }))
      expect(await f.port.viewBefore(f.handle, f.revision)).toBe(true)
      expect(ports.createWorker).toHaveBeenCalledTimes(1)
    },
  )

  it("rejects forged handles and wrong heads, and clears a released presentation", async () => {
    const f = await fixture()
    expect(await f.port.viewBefore({ id: Symbol("forged") }, f.revision)).toBe(false)
    expect(await f.port.viewBefore(f.handle, f.revision - 1)).toBe(false)
    expect(await f.port.viewBefore(f.handle, f.revision)).toBe(true)
    f.port.release(f.handle)
    expect(f.runtime.getDocumentControllerState().assistantCheckpointPresentation).toBeNull()
    expect(await f.port.viewBefore(f.handle, f.revision)).toBe(false)
    expect(ports.createWorker).not.toHaveBeenCalled()
  })

  it("does not publish a cached baseline after cancellation or owning runtime teardown", async () => {
    const f = await fixture()
    const pending = f.port.viewBefore(f.handle, f.revision)
    f.port.clearPreview()
    expect(await pending).toBe(false)
    expect(
      f.runtime.getDocumentControllerState().assistantCheckpointPresentation ?? null,
    ).toBeNull()
    await f.runtime.closeRuntime()
    expect(await f.port.viewBefore(f.handle, f.revision)).toBe(false)
    expect(ports.createWorker).not.toHaveBeenCalled()
  })

  it("invalidates retained Before on a later saved edit", async () => {
    const f = await fixture()
    expect(await f.port.viewBefore(f.handle, f.revision)).toBe(true)
    await f.runtime.renameActiveProject(f.revision, "Later human edit")
    expect(f.runtime.getDocumentControllerState().assistantCheckpointPresentation).toBeNull()
    expect(await f.port.viewBefore(f.handle, f.revision)).toBe(false)
  })

  it("keeps assembly placement inspection on captured authority when feature geometry is retained", async () => {
    const f = await fixture(undefined, true)
    expect(await f.port.viewBefore(f.handle, f.revision)).toBe(true)
    const presentation = f.runtime.getDocumentControllerState().assistantCheckpointPresentation
    expect(presentation?.assembly?.occurrences[0]?.geometryFrame.translation).toEqual([8, 0, 0])
    expect(ports.createWorker).toHaveBeenCalledWith(f.active.snapshot.id, {
      retryRecoverableFailure: false,
    })
    expect(ports.assemblyAssets).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Legacy extrusion" }),
      [],
    )
    expect(ports.inspectAssembly).toHaveBeenCalledTimes(1)
    expect(ports.rebuild).not.toHaveBeenCalled()
  })

  it("cancels an in-flight assembly inspection before publishing retained Before", async () => {
    const f = await fixture(undefined, true)
    let finish!: (assets: never[]) => void
    ports.assemblyAssets.mockImplementationOnce(
      () =>
        new Promise<never[]>((resolve) => {
          finish = resolve
        }),
    )
    const pending = f.port.viewBefore(f.handle, f.revision)
    expect(ports.assemblyAssets).toHaveBeenCalledTimes(1)
    f.port.clearPreview()
    finish([])
    expect(await pending).toBe(false)
    expect(ports.inspectAssembly).not.toHaveBeenCalled()
    expect(ports.terminate).toHaveBeenCalled()
  })

  it("lets a newer Before request supersede an unpublished retained presentation", async () => {
    const f = await fixture()
    const previous = f.port.viewBefore(f.handle, f.revision)
    const latest = f.port.viewBefore(f.handle, f.revision)
    expect(await previous).toBe(false)
    expect(await latest).toBe(true)
    expect(f.port.isViewingBefore(f.handle)).toBe(true)
  })

  it("preserves actor lineage rejection despite retained geometry for that handle", async () => {
    const f = await fixture()
    const handle = f.port.capture((actor) => actor.type === "mcp")
    if (!handle) throw new Error("Expected an actor-scoped checkpoint.")
    await f.runtime.renameActiveProject(f.revision, "Unaccepted human edit")
    expect(f.port.read(handle)).toBeNull()
    expect(await f.port.viewBefore(handle, f.revision)).toBe(false)
    expect(ports.createWorker).not.toHaveBeenCalled()
    f.port.release(handle)
  })
})
