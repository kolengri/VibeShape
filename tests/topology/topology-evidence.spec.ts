import { mkdirSync, writeFileSync } from "node:fs"
import { expect, type TestInfo, test } from "@playwright/test"
import { featureIdSchema } from "../../packages/domain/src/identifiers"
import {
  resolveTopologyReference,
  type TopologyCandidate,
  type TopologySignature,
  type TopoRef,
  topoRefSchema,
} from "../../packages/domain/src/topology"
import type { GeometryWorkerResponse } from "../../packages/protocol/src"
import { topologySpikeBaselineRoles } from "../../packages/test-models/src"

type TopologyResponse = Extract<GeometryWorkerResponse, { type: "topologySpikeCompleted" }>

interface TopologyScenarioResult {
  name: string
  missingBaselineRoles: string[]
  result: TopologyResponse
}

interface TopologySpikeHarnessState {
  state: "running" | "passed" | "failed"
  currentScenario: string | null
  scenarios: TopologyScenarioResult[]
  error: string | null
}

interface ScenarioEvidence {
  name: string
  candidateCount: number
  resolved: number
  missing: number
}

interface HistoryReference {
  semanticRole: string
  reference: TopoRef
}

interface ScenarioResultCounts {
  evidence: ScenarioEvidence
  semanticResolved: number
  semanticMissing: number
  historyResolved: number
  historyMissing: number
  falseConfidentMatches: number
}

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f21ac")

function requireCandidateByRole(candidates: TopologyCandidate[], semanticRole: string) {
  const matches = candidates.filter((candidate) => candidate.semanticRole === semanticRole)
  expect(matches, `Expected one candidate for ${semanticRole}.`).toHaveLength(1)
  return matches[0] as TopologyCandidate
}

function createReference(candidate: TopologyCandidate, includeSemanticRole = true): TopoRef {
  return topoRefSchema.parse({
    schemaVersion: 0,
    featureId,
    kind: candidate.kind,
    ...(includeSemanticRole && candidate.semanticRole
      ? { semanticRole: candidate.semanticRole }
      : {}),
    signature: candidate.signature,
  })
}

function createLineageReference(candidate: TopologyCandidate, semanticRole: string) {
  const lineageToken = `output:${semanticRole}`
  expect(candidate.lineageTokens).toContain(lineageToken)
  return topoRefSchema.parse({
    schemaVersion: 0,
    featureId,
    kind: candidate.kind,
    lineageToken,
    signature: candidate.signature,
  })
}

function averageVector(
  left: [number, number, number],
  right: [number, number, number],
): [number, number, number] {
  return left.map((value, index) => (value + (right[index] as number)) / 2) as [
    number,
    number,
    number,
  ]
}

function symmetricSignature(left: TopologySignature, right: TopologySignature): TopologySignature {
  expect(left.kind).toBe(right.kind)
  expect(left.geometryClass).toBe(right.geometryClass)
  expect(left.boundaryCount).toBe(right.boundaryCount)
  expect(left.adjacentGeometryClasses).toEqual(right.adjacentGeometryClasses)

  return {
    kind: left.kind,
    geometryClass: left.geometryClass,
    measure: (left.measure + right.measure) / 2,
    centroid: averageVector(left.centroid, right.centroid),
    bounds: {
      min: averageVector(left.bounds.min, right.bounds.min),
      max: averageVector(left.bounds.max, right.bounds.max),
    },
    boundaryCount: left.boundaryCount,
    adjacentGeometryClasses: left.adjacentGeometryClasses,
    ...(left.direction ? { direction: left.direction, directionMode: "axis" as const } : {}),
  }
}

function duplicateRoleDiagnostics(candidates: TopologyCandidate[]) {
  const roleCandidates = new Map<string, TopologyCandidate[]>()
  for (const candidate of candidates) {
    if (!candidate.semanticRole) continue
    const matches = roleCandidates.get(candidate.semanticRole) ?? []
    matches.push(candidate)
    roleCandidates.set(candidate.semanticRole, matches)
  }
  return Object.fromEntries(
    [...roleCandidates]
      .filter(([, matches]) => matches.length > 1)
      .map(([role, matches]) => [
        role,
        matches.map((candidate) => ({
          candidateId: candidate.candidateId,
          geometryClass: candidate.signature.geometryClass,
          centroid: candidate.signature.centroid,
          direction: candidate.signature.direction,
          measure: candidate.signature.measure,
        })),
      ]),
  )
}

function assertScenarioCandidates(scenario: TopologyScenarioResult) {
  const candidates = scenario.result.topologyCandidates as TopologyCandidate[]
  expect(scenario.result.shape).toMatchObject({ valid: true, solidCount: 1 })
  expect(new Set(candidates.map((candidate) => candidate.candidateId)).size).toBe(candidates.length)
  const semanticRoles = candidates.flatMap((candidate) =>
    candidate.semanticRole ? [candidate.semanticRole] : [],
  )
  expect(
    new Set(semanticRoles).size,
    `${scenario.name} has duplicate semantic roles: ${JSON.stringify(duplicateRoleDiagnostics(candidates))}`,
  ).toBe(semanticRoles.length)
  return candidates
}

function resolveSemanticCorpus(
  scenario: TopologyScenarioResult,
  candidates: TopologyCandidate[],
  references: TopoRef[],
) {
  let resolved = 0
  let missing = 0
  let falseConfidentMatches = 0
  for (const reference of references) {
    const resolution = resolveTopologyReference(reference, candidates)
    if (scenario.missingBaselineRoles.includes(reference.semanticRole ?? "")) {
      expect(resolution).toEqual({
        status: "missing",
        reason: "semantic-role-missing",
        bestScore: null,
      })
      missing += 1
      continue
    }
    expect(resolution).toMatchObject({ status: "resolved", method: "semantic" })
    if (resolution.status !== "resolved") continue
    const candidate = candidates.find((item) => item.candidateId === resolution.candidateId)
    if (candidate?.semanticRole !== reference.semanticRole) falseConfidentMatches += 1
    resolved += 1
  }
  return { resolved, missing, falseConfidentMatches }
}

function resolveHistoryCorpus(
  scenario: TopologyScenarioResult,
  candidates: TopologyCandidate[],
  references: HistoryReference[],
) {
  let resolved = 0
  let missing = 0
  for (const item of references) {
    const resolution = resolveTopologyReference(item.reference, candidates)
    if (scenario.missingBaselineRoles.includes(item.semanticRole)) {
      expect(resolution).toEqual({
        status: "missing",
        reason: "lineage-missing",
        bestScore: null,
      })
      missing += 1
      continue
    }
    expect(resolution).toMatchObject({ status: "resolved", method: "history" })
    if (resolution.status !== "resolved") continue
    expect(
      candidates.find((candidate) => candidate.candidateId === resolution.candidateId)
        ?.semanticRole,
    ).toBe(item.semanticRole)
    resolved += 1
  }
  return { resolved, missing }
}

function verifyScenario(
  scenario: TopologyScenarioResult,
  semanticReferences: TopoRef[],
  historyReferences: HistoryReference[],
): ScenarioResultCounts {
  const candidates = assertScenarioCandidates(scenario)
  const semantic = resolveSemanticCorpus(scenario, candidates, semanticReferences)
  const history = resolveHistoryCorpus(scenario, candidates, historyReferences)
  return {
    evidence: {
      name: scenario.name,
      candidateCount: candidates.length,
      resolved: semantic.resolved,
      missing: semantic.missing,
    },
    semanticResolved: semantic.resolved,
    semanticMissing: semantic.missing,
    historyResolved: history.resolved,
    historyMissing: history.missing,
    falseConfidentMatches: semantic.falseConfidentMatches,
  }
}

function verifySignatureResolution(baselineCandidates: TopologyCandidate[]) {
  const cap = requireCandidateByRole(baselineCandidates, "base-extrude.cap.end")
  const signatureResolution = resolveTopologyReference(
    createReference(cap, false),
    baselineCandidates,
  )
  expect(signatureResolution).toMatchObject({
    status: "resolved",
    candidateId: cap.candidateId,
    method: "signature",
  })
  const negativeHole = requireCandidateByRole(baselineCandidates, "pattern.hole.negative.wall")
  const positiveHole = requireCandidateByRole(baselineCandidates, "pattern.hole.positive.wall")
  const symmetricReference = topoRefSchema.parse({
    schemaVersion: 0,
    featureId,
    kind: negativeHole.kind,
    signature: symmetricSignature(negativeHole.signature, positiveHole.signature),
  })
  const symmetricResolution = resolveTopologyReference(symmetricReference, [
    negativeHole,
    positiveHole,
  ])
  expect(symmetricResolution).toMatchObject({ status: "ambiguous", method: "signature" })
  return { signatureResolution, symmetricResolution }
}

function sum(results: ScenarioResultCounts[], key: keyof Omit<ScenarioResultCounts, "evidence">) {
  return results.reduce((total, result) => total + result[key], 0)
}

async function writeEvidence(evidence: object, testInfo: TestInfo) {
  const evidenceJson = `${JSON.stringify(evidence, null, 2)}\n`
  mkdirSync(".artifacts/topology-spike", { recursive: true })
  writeFileSync(".artifacts/topology-spike/evidence-report.json", evidenceJson)
  await testInfo.attach("stable-topology-evidence", {
    body: evidenceJson,
    contentType: "application/json",
  })
}

test("records fail-closed stable topology evidence from the local OCCT corpus", async ({
  browser,
  page,
}, testInfo) => {
  await page.goto("/spikes/topology.html")

  const status = page.getByRole("status")
  await expect(status).not.toHaveAttribute("data-state", "running", { timeout: 120_000 })

  const spike = await page.evaluate<TopologySpikeHarnessState>(() =>
    Reflect.get(globalThis, "__VIBESHAPE_TOPOLOGY_SPIKE__"),
  )
  expect(
    spike.state,
    `Topology scenario ${spike.currentScenario ?? "unknown"} failed: ${spike.error ?? "unknown error"}`,
  ).toBe("passed")
  await expect(status).toHaveAttribute("data-state", "passed")
  expect(spike.error).toBeNull()
  expect(spike.scenarios.length).toBeGreaterThan(10)

  const baseline = spike.scenarios[0]
  if (!baseline) throw new Error("The topology corpus did not publish a baseline scenario.")

  const baselineCandidates = baseline.result.topologyCandidates as TopologyCandidate[]
  const references = topologySpikeBaselineRoles.map((role) =>
    createReference(requireCandidateByRole(baselineCandidates, role)),
  )
  const historyReferences = ["base-extrude.cap.end", "pattern.hole.negative.wall"].map(
    (semanticRole) => ({
      semanticRole,
      reference: createLineageReference(
        requireCandidateByRole(baselineCandidates, semanticRole),
        semanticRole,
      ),
    }),
  )
  const results = spike.scenarios.map((scenario) =>
    verifyScenario(scenario, references, historyReferences),
  )
  const falseConfidentMatches = sum(results, "falseConfidentMatches")
  expect(falseConfidentMatches).toBe(0)
  const { signatureResolution, symmetricResolution } = verifySignatureResolution(baselineCandidates)

  const evidence = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    browser: `Chromium ${browser.version()}`,
    scenarioCount: spike.scenarios.length,
    baselineReferenceCount: references.length,
    resolvedCount: sum(results, "semanticResolved"),
    missingCount: sum(results, "semanticMissing"),
    historyReferenceCount: historyReferences.length,
    historyResolvedCount: sum(results, "historyResolved"),
    historyMissingCount: sum(results, "historyMissing"),
    falseConfidentMatches,
    signatureResolution,
    symmetricResolution,
    scenarios: results.map((result) => result.evidence),
  }
  await writeEvidence(evidence, testInfo)
})
