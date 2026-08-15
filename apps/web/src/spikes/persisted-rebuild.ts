import {
  createPersistentDocumentSession,
  openPersistentDocumentSession,
  type PersistentDocumentSession,
  type PersistentDocumentSessionDependencies,
} from "@vibeshape/application/persistent-document-session"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import {
  booleanFeatureType,
  boxFeatureType,
  createCommandDispatcher,
  createCoreCommandHandlers,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  cylinderFeatureType,
  documentCoreModule,
  type FeatureRecord,
  featureCoreModule,
  featureIdSchema,
  partDesignFeatureTypeHandlers,
  partDesignModule,
  sessionIdSchema,
} from "@vibeshape/domain"
import {
  acquireDocumentLease,
  LocalDocumentRepository,
  releaseDocumentLease,
  VibeShapeDatabase,
} from "@vibeshape/persistence"
import { isError } from "is-what"

type RebuildSummary = Readonly<{
  evaluatedFeatureIds: readonly string[]
  reusedFeatureIds: readonly string[]
  geometry: readonly {
    featureId: string
    contentHash: string
    volume: number
  }[]
}>

interface PersistedRebuildHarnessState {
  state: "running" | "passed" | "closed" | "failed"
  phase: "created" | "opened" | null
  recoveryStatus: "created" | "clean" | "recovered" | "recovered-with-loss" | null
  mode: "read-write" | "read-only" | null
  revision: number
  variables: readonly { name: string; expression: string }[]
  rebuild: RebuildSummary | null
  closeResult: "clean" | "failed" | null
  error: string | null
}

interface PersistedRebuildHarnessControl {
  close(): Promise<void>
}

declare global {
  interface Window {
    __VIBESHAPE_PERSISTED_REBUILD__: PersistedRebuildHarnessState
    __VIBESHAPE_PERSISTED_REBUILD_CONTROL__: PersistedRebuildHarnessControl
  }
}

const databaseName = "vibeshape-persisted-rebuild-v0"
const documentId = "0195b5ac-b250-7f2c-9c33-67a36a7f21ac"
const browserSessionId = "0195b5ac-b250-7f2c-9c33-67a36a7f21ad"
const variableId = "0195b5ac-b250-7f2c-9c33-67a36a7f21ae"
const featureIds = {
  box: featureIdSchema.parse("0195b5ac-b250-7f2c-9c33-67a36a7f3101"),
  cylinder: featureIdSchema.parse("0195b5ac-b250-7f2c-9c33-67a36a7f3102"),
  boolean: featureIdSchema.parse("0195b5ac-b250-7f2c-9c33-67a36a7f3103"),
} as const
const commandIds = [
  "0195b5ac-b250-7f2c-9c33-67a36a7f3201",
  "0195b5ac-b250-7f2c-9c33-67a36a7f3202",
  "0195b5ac-b250-7f2c-9c33-67a36a7f3203",
  "0195b5ac-b250-7f2c-9c33-67a36a7f3204",
  "0195b5ac-b250-7f2c-9c33-67a36a7f3205",
] as const
const mesh = { chordTolerance: 0.05, angularTolerance: 0.1 } as const

const state: PersistedRebuildHarnessState = {
  state: "running",
  phase: null,
  recoveryStatus: null,
  mode: null,
  revision: 0,
  variables: [],
  rebuild: null,
  closeResult: null,
  error: null,
}

window.__VIBESHAPE_PERSISTED_REBUILD__ = state

function statusElement() {
  const element = document.querySelector<HTMLElement>("#status")
  if (!element) throw new Error("The persisted rebuild status element is missing.")
  return element
}

function coreCommandDispatcher() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  const dispatcher = createCommandDispatcher(
    modules.registry,
    createCoreCommandHandlers(featureTypes.registry),
  )
  if (!dispatcher.ok) throw new Error(dispatcher.diagnostic.message)
  return dispatcher.dispatcher
}

function sessionDependencies(
  database: VibeShapeDatabase,
  repository: LocalDocumentRepository,
): PersistentDocumentSessionDependencies {
  return {
    commandDispatcher: coreCommandDispatcher(),
    repository,
    leases: {
      acquire: (input) => acquireDocumentLease(database, input),
      release: (input) => releaseDocumentLease(database, input),
    },
    createRebuildPort: (id) => createDocumentWorkerSession(id),
    now: () => Date.now(),
  }
}

function commandEnvelope(index: number, baseRevision: number) {
  const commandId = commandIds[index]
  if (!commandId) throw new Error("The persisted rebuild command ID is missing.")
  return {
    schemaVersion: 1 as const,
    commandId,
    documentId,
    baseRevision,
    issuedAt: `2026-08-09T00:00:0${baseRevision}.000Z`,
    actor: { type: "user" as const, userId: null },
  }
}

function features() {
  const box: FeatureRecord = {
    schemaVersion: 0,
    id: featureIds.box,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20, "mm", "#width"),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(25.4),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
  const cylinder: FeatureRecord = {
    schemaVersion: 0,
    id: featureIds.cylinder,
    type: cylinderFeatureType.type,
    parameters: {
      radius: createLengthQuantity(5),
      height: createLengthQuantity(60),
      centered: true,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
  const boolean: FeatureRecord = {
    schemaVersion: 0,
    id: featureIds.boolean,
    type: booleanFeatureType.type,
    parameters: { operation: "subtract" },
    dependencies: [featureIds.box, featureIds.cylinder],
    references: [],
    suppressed: false,
  }
  return { box, cylinder, boolean }
}

function requireCommit(result: Awaited<ReturnType<PersistentDocumentSession["commit"]>>) {
  if (!result.ok) throw new Error(`${result.diagnostic.code}: ${result.diagnostic.message}`)
  if (!result.rebuild.ok) {
    throw new Error(`${result.rebuild.diagnostic.code}: ${result.rebuild.diagnostic.message}`)
  }
  return { ...result, rebuild: result.rebuild }
}

async function createModel(
  dependencies: PersistentDocumentSessionDependencies,
  sessionId: ReturnType<typeof sessionIdSchema.parse>,
) {
  const created = await createPersistentDocumentSession(dependencies, {
    sessionId,
    mesh,
    command: {
      ...commandEnvelope(0, 0),
      kind: "org.vibeshape.document.create",
      payload: { name: "Persisted configurable bracket" },
    },
  })
  if (!created.ok) throw new Error(`${created.diagnostic.code}: ${created.diagnostic.message}`)
  const session = created.session
  requireCommit(
    await session.commit({
      ...commandEnvelope(1, 1),
      kind: "org.vibeshape.variable.add",
      payload: {
        variable: { schemaVersion: 0, id: variableId, name: "width", expression: "20 mm" },
      },
    }),
  )
  const records = features()
  requireCommit(
    await session.commit({
      ...commandEnvelope(2, 2),
      kind: "org.vibeshape.feature.add",
      payload: { feature: records.box },
    }),
  )
  requireCommit(
    await session.commit({
      ...commandEnvelope(3, 3),
      kind: "org.vibeshape.feature.add",
      payload: { feature: records.cylinder },
    }),
  )
  const final = requireCommit(
    await session.commit({
      ...commandEnvelope(4, 4),
      kind: "org.vibeshape.feature.add",
      payload: { feature: records.boolean },
    }),
  )
  return { session, response: final.rebuild.response, status: created.report.status }
}

function summarize(response: Awaited<ReturnType<DocumentRebuildPortLike["rebuild"]>>) {
  return {
    evaluatedFeatureIds: response.evaluation.evaluatedFeatureIds,
    reusedFeatureIds: response.evaluation.reusedFeatureIds,
    geometry: response.geometry.map(({ featureId, contentHash, geometry }) => ({
      featureId,
      contentHash,
      volume: geometry.shape.volume,
    })),
  }
}

type DocumentRebuildPortLike = ReturnType<typeof createDocumentWorkerSession>

function currentBrowserSessionId() {
  const storedSessionId = sessionStorage.getItem("vibeshape-persisted-rebuild-session")
  const sessionId = sessionIdSchema.parse(storedSessionId ?? browserSessionId)
  sessionStorage.setItem("vibeshape-persisted-rebuild-session", sessionId)
  return sessionId
}

async function openOrCreateModel(
  dependencies: PersistentDocumentSessionDependencies,
  sessionId: ReturnType<typeof sessionIdSchema.parse>,
) {
  const opened = await openPersistentDocumentSession(dependencies, {
    documentId,
    sessionId,
    mesh,
  })
  if (opened.ok) {
    if (!opened.report.rebuild.ok) throw new Error(opened.report.rebuild.diagnostic.message)
    return {
      session: opened.session,
      response: opened.report.rebuild.response,
      phase: "opened" as const,
      recoveryStatus: opened.report.status,
      mode: opened.report.mode,
    }
  }
  if (opened.diagnostic.sourceCode !== "document-not-found") {
    throw new Error(`${opened.diagnostic.code}: ${opened.diagnostic.message}`)
  }
  const created = await createModel(dependencies, sessionId)
  return {
    ...created,
    phase: "created" as const,
    recoveryStatus: created.status,
    mode: created.session.mode,
  }
}

function publishOpenedModel(
  opened: Awaited<ReturnType<typeof openOrCreateModel>>,
  status: HTMLElement,
) {
  state.phase = opened.phase
  state.recoveryStatus = opened.recoveryStatus
  state.mode = opened.mode
  state.revision = opened.session.snapshot.revision
  state.variables = opened.session.snapshot.variables.map(({ name, expression }) => ({
    name,
    expression,
  }))
  state.rebuild = summarize(opened.response)
  state.state = "passed"
  status.dataset.state = "passed"
  status.textContent = "Persisted document rebuild passed."
}

function installCloseControl(
  session: PersistentDocumentSession,
  database: VibeShapeDatabase,
  status: HTMLElement,
) {
  window.__VIBESHAPE_PERSISTED_REBUILD_CONTROL__ = {
    async close() {
      const closed = await session.close()
      state.closeResult = closed.ok ? "clean" : "failed"
      state.state = "closed"
      status.dataset.state = "closed"
      status.textContent = closed.ok
        ? "Persisted document closed cleanly."
        : "Persisted document close failed."
      database.close()
    },
  }
}

function publishFailure(error: unknown, database: VibeShapeDatabase, status: HTMLElement) {
  database.close()
  state.state = "failed"
  state.error = isError(error) ? error.message : "Unknown persisted rebuild failure."
  status.dataset.state = "failed"
  status.textContent = state.error
}

async function run() {
  const status = statusElement()
  const database = new VibeShapeDatabase(databaseName)
  const repository = new LocalDocumentRepository(database)
  const dependencies = sessionDependencies(database, repository)
  try {
    const opened = await openOrCreateModel(dependencies, currentBrowserSessionId())
    publishOpenedModel(opened, status)
    installCloseControl(opened.session, database, status)
  } catch (error) {
    publishFailure(error, database, status)
  }
}

void run()
