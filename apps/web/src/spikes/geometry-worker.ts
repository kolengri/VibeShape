import {
  createGeometryRequestEnvelope,
  createGeometryWorkerClient,
  type GeometryWorkerClient,
} from "@vibeshape/geometry-worker/client"
import { geometryLifecycleOperationSchema } from "@vibeshape/protocol"
import { createKernelSpikeParameters } from "@vibeshape/test-models"
import { z } from "zod"

type TerminalResponse = Awaited<ReturnType<GeometryWorkerClient["request"]>>
type KernelResponse = Extract<TerminalResponse, { type: "kernelSpikeCompleted" }>
type HealthResponse = Extract<TerminalResponse, { type: "health" }>
type DisposalResponse = Extract<TerminalResponse, { type: "documentDisposed" }>

interface GeometryWorkerRestartEvidence {
  beforeTermination: HealthResponse
  afterInitialization: HealthResponse
  result: KernelResponse
  disposal: DisposalResponse
}

interface GeometrySpikeHarnessState {
  state: "running" | "passed" | "failed"
  result: KernelResponse | null
  results: KernelResponse[]
  health: HealthResponse | null
  disposal: DisposalResponse | null
  restart: GeometryWorkerRestartEvidence | null
  progress: string[]
  error: string | null
}

const booleanQueryParameterSchema = z.enum(["true", "false"]).transform((value) => value === "true")

declare global {
  interface Window {
    __VIBESHAPE_GEOMETRY_SPIKE__: GeometrySpikeHarnessState
  }
}

function isResponseType<Type extends TerminalResponse["type"]>(
  response: TerminalResponse,
  type: Type,
): response is Extract<TerminalResponse, { type: Type }> {
  return response.type === type
}

function expectResponse<Type extends TerminalResponse["type"]>(
  response: TerminalResponse,
  type: Type,
): Extract<TerminalResponse, { type: Type }> {
  if (!isResponseType(response, type)) {
    throw new Error(`Expected ${type}, received ${response.type}.`)
  }

  return response
}

function requireStatusElement() {
  const element = document.querySelector<HTMLElement>("#status")

  if (!element) {
    throw new Error("The geometry spike status element is missing.")
  }

  return element
}

const statusElement = requireStatusElement()
const documentId = "occt-worker-spike"
const generation = 1
const state: GeometrySpikeHarnessState = {
  state: "running",
  result: null,
  results: [],
  health: null,
  disposal: null,
  restart: null,
  progress: [],
  error: null,
}

window.__VIBESHAPE_GEOMETRY_SPIKE__ = state

function readPositiveIntegerParameter(name: string, fallback: number, maximum: number) {
  const requested = new URLSearchParams(window.location.search).get(name)

  if (requested === null) {
    return fallback
  }

  const value = Number(requested)

  assertBoundedInteger(name, value, maximum)
  return value
}

function assertBoundedInteger(name: string, value: number, maximum: number) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer.`)
  }

  if (value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`)
  }
}

function createSpikeParameters() {
  const parameters = createKernelSpikeParameters()
  const searchParameters = new URLSearchParams(window.location.search)
  const lifecycleIterations = readPositiveIntegerParameter(
    "lifecycleIterations",
    parameters.lifecycleIterations,
    1_000,
  )
  const requestedOperation = searchParameters.get("lifecycleOperation")
  const lifecycleOperation = geometryLifecycleOperationSchema.parse(
    requestedOperation ?? parameters.lifecycleOperation,
  )
  const requestedPurge = searchParameters.get("purgeAfterLifecycle")
  const purgeAfterLifecycle = requestedPurge
    ? booleanQueryParameterSchema.parse(requestedPurge)
    : parameters.purgeAfterLifecycle

  return { ...parameters, lifecycleIterations, lifecycleOperation, purgeAfterLifecycle }
}

async function initializeEngine(client: GeometryWorkerClient) {
  const initialized = await client.request({
    ...createGeometryRequestEnvelope(documentId, generation),
    type: "initializeEngine",
  })
  expectResponse(initialized, "initialized")
}

async function readHealth(client: GeometryWorkerClient) {
  return expectResponse(
    await client.request({
      ...createGeometryRequestEnvelope(documentId, generation),
      type: "healthCheck",
    }),
    "health",
  )
}

async function disposeDocument(client: GeometryWorkerClient) {
  return expectResponse(
    await client.request({
      ...createGeometryRequestEnvelope(documentId, generation),
      type: "disposeDocument",
    }),
    "documentDisposed",
  )
}

async function runKernelFixture(
  client: GeometryWorkerClient,
  lifecycleIterations: number | null,
  reportProgress: boolean,
) {
  const parameters = createSpikeParameters()
  const result = await client.request(
    {
      ...createGeometryRequestEnvelope(documentId, generation),
      type: "runKernelSpike",
      parameters:
        lifecycleIterations === null ? parameters : { ...parameters, lifecycleIterations },
    },
    reportProgress
      ? {
          onProgress(stage, fraction) {
            state.progress.push(stage)
            statusElement.textContent = `${stage}: ${Math.round(fraction * 100)}%`
          },
        }
      : {},
  )

  return expectResponse(result, "kernelSpikeCompleted")
}

async function runPrimaryWorker() {
  const client = createGeometryWorkerClient()

  try {
    await initializeEngine(client)

    const lifecycleBatches = readPositiveIntegerParameter("lifecycleBatches", 1, 10)

    for (let batch = 0; batch < lifecycleBatches; batch += 1) {
      state.result = await runKernelFixture(client, null, true)
      state.results.push(state.result)
    }

    const beforeTermination = await readHealth(client)
    state.health = beforeTermination
    state.disposal = await disposeDocument(client)
    return beforeTermination
  } finally {
    client.terminate()
  }
}

async function runRestartedWorker(beforeTermination: HealthResponse) {
  const client = createGeometryWorkerClient()

  try {
    await initializeEngine(client)
    const afterInitialization = await readHealth(client)
    const result = await runKernelFixture(client, 1, false)
    const disposal = await disposeDocument(client)

    return { beforeTermination, afterInitialization, result, disposal }
  } finally {
    client.terminate()
  }
}

async function runSpike() {
  try {
    const beforeTermination = await runPrimaryWorker()
    state.restart = await runRestartedWorker(beforeTermination)

    state.state = "passed"
    statusElement.dataset.state = "passed"
    statusElement.textContent = "Geometry worker spike passed."
  } catch (error) {
    state.state = "failed"
    state.error = error instanceof Error ? error.message : "Unknown geometry spike failure."
    statusElement.dataset.state = "failed"
    statusElement.textContent = state.error
  }
}

void runSpike()
