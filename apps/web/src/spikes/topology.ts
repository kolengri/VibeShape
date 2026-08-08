import {
  createGeometryRequestEnvelope,
  createGeometryWorkerClient,
  type GeometryWorkerClient,
} from "@vibeshape/geometry-worker/client"
import type { GeometryTerminalResponse } from "@vibeshape/protocol"
import { topologySpikeScenarios } from "@vibeshape/test-models"

type TopologyResponse = Extract<GeometryTerminalResponse, { type: "topologySpikeCompleted" }>
type HealthResponse = Extract<GeometryTerminalResponse, { type: "health" }>

interface TopologyScenarioResult {
  name: string
  missingBaselineRoles: string[]
  result: TopologyResponse
}

interface TopologySpikeHarnessState {
  state: "running" | "passed" | "failed"
  currentScenario: string | null
  scenarios: TopologyScenarioResult[]
  health: HealthResponse | null
  error: string | null
}

declare global {
  interface Window {
    __VIBESHAPE_TOPOLOGY_SPIKE__: TopologySpikeHarnessState
  }
}

function requireStatusElement() {
  const element = document.querySelector<HTMLElement>("#status")
  if (!element) throw new Error("The topology spike status element is missing.")
  return element
}

function requireResponse<Type extends GeometryTerminalResponse["type"]>(
  response: GeometryTerminalResponse,
  type: Type,
): Extract<GeometryTerminalResponse, { type: Type }> {
  if (response.type !== type) {
    throw new Error(`Expected ${type}, received ${response.type}.`)
  }
  return response as Extract<GeometryTerminalResponse, { type: Type }>
}

const statusElement = requireStatusElement()
const documentId = "topology-spike"
const state: TopologySpikeHarnessState = {
  state: "running",
  currentScenario: null,
  scenarios: [],
  health: null,
  error: null,
}
window.__VIBESHAPE_TOPOLOGY_SPIKE__ = state

async function initialize(client: GeometryWorkerClient) {
  const response = await client.request({
    ...createGeometryRequestEnvelope(documentId, 0),
    type: "initializeEngine",
  })
  requireResponse(response, "initialized")
}

async function runScenarios(client: GeometryWorkerClient) {
  for (const [index, scenario] of topologySpikeScenarios.entries()) {
    state.currentScenario = scenario.name
    statusElement.textContent = `Running ${scenario.name}…`
    const response = await client.request({
      ...createGeometryRequestEnvelope(documentId, index + 1),
      type: "runTopologySpike",
      parameters: scenario.parameters,
    })
    state.scenarios.push({
      name: scenario.name,
      missingBaselineRoles: scenario.missingBaselineRoles,
      result: requireResponse(response, "topologySpikeCompleted"),
    })
  }
}

async function runSpike() {
  const client = createGeometryWorkerClient()
  try {
    await initialize(client)
    await runScenarios(client)
    state.health = requireResponse(
      await client.request({
        ...createGeometryRequestEnvelope(documentId, topologySpikeScenarios.length + 1),
        type: "healthCheck",
      }),
      "health",
    )
    await client.request({
      ...createGeometryRequestEnvelope(documentId, topologySpikeScenarios.length + 1),
      type: "disposeDocument",
    })
    state.currentScenario = null
    state.state = "passed"
    statusElement.dataset.state = "passed"
    statusElement.textContent = "Topology reference corpus completed."
  } catch (error) {
    state.state = "failed"
    state.error = error instanceof Error ? error.message : String(error)
    statusElement.dataset.state = "failed"
    statusElement.textContent = state.error
  } finally {
    client.terminate()
  }
}

void runSpike()
