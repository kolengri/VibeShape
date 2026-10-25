import { expect, it } from "bun:test"
import type { EdgeTopoRef, TopologyCandidate } from "@vibeshape/domain"
import { bodyTopoRefSchema } from "@vibeshape/domain/body-topology-reference"
import {
  candidate,
  copy,
  geometry,
  option,
  otherId,
  sourceId,
  treatmentId,
} from "./edge-treatment.test-fixtures"
import {
  type EdgeTreatmentCandidate,
  edgeTreatmentCandidates,
  legacyEdgeReference,
  prepareTreatmentReferenceResolution,
  resolveTreatmentReference,
} from "./edge-treatment-candidates"
import {
  initialTreatmentValues,
  promoteTreatmentTargets,
  treatmentFeature,
} from "./edge-treatment-model"
import { applyTreatmentPick } from "./edge-treatment-picking"

function entry(topology: TopologyCandidate, role = "result", featureId = sourceId) {
  const reference = bodyTopoRefSchema.parse({
    schemaVersion: 1,
    featureId,
    outputRole: role,
    kind: topology.kind,
    signature: topology.signature,
  })
  return {
    id: JSON.stringify([featureId, role, topology.candidateId]),
    candidateId: topology.candidateId,
    optionId: JSON.stringify([featureId, role]),
    label: topology.candidateId,
    candidate: topology,
    reference,
    resolveStatus: () => "resolved" as const,
  } satisfies EdgeTreatmentCandidate
}

function tracked(entries: readonly EdgeTreatmentCandidate[]) {
  let reads = 0
  return {
    entries: entries.map((entry) => ({
      ...entry,
      get candidate() {
        reads++
        return entry.candidate
      },
    })),
    reads: () => reads,
  }
}

function legacy(reference: EdgeTreatmentCandidate["reference"]): EdgeTopoRef {
  const result = legacyEdgeReference(reference)
  if (!result) throw new Error("The fixture requires a result edge.")
  return result
}

it("prepares one complete index per queried scope across repeated v0/v1 reference batches", () => {
  const edges = Array.from({ length: 128 }, (_, index) => entry(candidate("edge", index + 1)))
  const values = tracked(edges)
  const resolution = prepareTreatmentReferenceResolution(values.entries)
  expect(values.reads()).toBe(0)
  for (let round = 0; round < 2; round++) {
    for (const [index, edge] of edges.entries()) {
      for (const reference of [edge.reference, legacy(edge.reference)]) {
        const result = resolution.resolve(reference)
        expect(result.status).toBe("resolved")
        const expected = values.entries[index]
        if (!expected) throw new Error("The batch fixture requires a matching candidate.")
        if (result.status === "resolved") expect(result.candidate).toBe(expected)
      }
    }
  }
  expect(values.reads()).toBe(128)
})

it("keeps feature, role, kind and explicit option restrictions distinct", () => {
  const result = entry(candidate("edge"))
  const sibling = entry(candidate("edge"), "pattern.instance.1")
  const foreign = entry(candidate("edge"), "result", otherId)
  const face = entry(candidate("face"))
  const entries = [result, sibling, foreign, face]
  const resolution = prepareTreatmentReferenceResolution(entries)
  for (const candidate of entries) {
    expect(resolution.resolve(candidate.reference)).toEqual({ status: "resolved", candidate })
  }
  expect(resolution.resolve(legacy(result.reference))).toEqual({
    status: "resolved",
    candidate: result,
  })
  expect(prepareTreatmentReferenceResolution([sibling]).resolve(legacy(result.reference))).toEqual({
    status: "missing",
  })
  expect(resolution.resolve(result.reference, sibling.optionId)).toEqual({ status: "missing" })
  expect(resolution.resolve(result.reference, result.optionId)).toEqual({
    status: "resolved",
    candidate: result,
  })
  expect(resolution.resolve({ ...result.reference, outputRole: "absent" })).toEqual({
    status: "missing",
  })
  expect(prepareTreatmentReferenceResolution([]).resolve(result.reference)).toEqual({
    status: "missing",
  })
})

it("retains semantic and lineage authority over an exact but unowned geometric match", () => {
  const exact = entry(candidate("edge"))
  const owned = entry({
    ...candidate("edge", 100),
    semanticRole: "owned-edge",
    lineageTokens: ["ancestor"],
  })
  const resolution = prepareTreatmentReferenceResolution([exact, owned])
  expect(
    resolution.resolve({ ...exact.reference, semanticRole: "owned-edge", lineageToken: "absent" }),
  ).toEqual({ status: "resolved", candidate: owned })
  expect(resolution.resolve({ ...exact.reference, lineageToken: "ancestor" })).toEqual({
    status: "resolved",
    candidate: owned,
  })
  expect(
    resolution.resolve({ ...exact.reference, semanticRole: "absent", lineageToken: "ancestor" }),
  ).toEqual({ status: "missing" })
  expect(resolution.resolve({ ...exact.reference, lineageToken: "absent" })).toEqual({
    status: "missing",
  })
  const duplicateRole = entry({ ...candidate("edge", 3), semanticRole: "owned-edge" })
  expect(
    prepareTreatmentReferenceResolution([exact, owned, duplicateRole]).resolve({
      ...exact.reference,
      semanticRole: "owned-edge",
    }),
  ).toEqual({ status: "ambiguous" })
})

it("retains unresolved nearby peers, conservative margins, and authored intent", () => {
  const base = candidate("edge")
  const first = entry({ ...base, signature: { ...base.signature, centroid: [0, 0, 0] } })
  const peer = {
    ...entry({
      ...base,
      candidateId: "peer",
      signature: { ...base.signature, centroid: [0.1, 0, 0] },
    }),
    resolveStatus: () => "missing" as const,
  }
  const resolution = prepareTreatmentReferenceResolution([first, peer])
  const reference = {
    ...first.reference,
    signature: { ...first.reference.signature, centroid: [0.03, 0, 0] as [number, number, number] },
  }
  expect(resolution.resolve(reference)).toEqual({ status: "ambiguous" })
  expect(resolution.matchesCandidate(reference, first)).toBe(false)
  expect(resolution.resolve(first.reference)).toEqual({ status: "resolved", candidate: first })
  expect(resolution.resolve({ ...first.reference, intent: { nearPoint: [0, 0, 0] } })).toEqual({
    status: "ambiguous",
  })
  const descendants = [-4, 4].map((x, index) =>
    entry({
      ...base,
      candidateId: `split-${index}`,
      lineageTokens: ["ancestor"],
      signature: { ...base.signature, centroid: [x, 0, 0] },
    }),
  )
  const split = prepareTreatmentReferenceResolution(descendants)
  const descendant = descendants[1]
  if (!descendant) throw new Error("The split fixture requires a second descendant.")
  const stored = { ...first.reference, lineageToken: "ancestor" }
  expect(split.resolve(stored)).toEqual({ status: "ambiguous" })
  expect(split.resolve({ ...stored, intent: { nearPoint: [4, 0, 0] } })).toEqual({
    status: "resolved",
    candidate: descendant,
  })
})

it("validates only the queried scope, before validating its reference, including repeat failures", () => {
  const good = entry(candidate("edge"))
  const malformed = entry(candidate("edge"), "malformed")
  const invalid = {
    ...malformed,
    candidate: {
      ...malformed.candidate,
      signature: { ...malformed.candidate.signature, measure: NaN },
    },
  }
  const duplicated = entry(candidate("edge"), "duplicate")
  const resolution = prepareTreatmentReferenceResolution([good, invalid, duplicated, duplicated])
  const badRef = { ...good.reference, signature: { ...good.reference.signature, measure: NaN } }
  expect(resolution.resolve(good.reference)).toEqual({ status: "resolved", candidate: good })
  expect(() => resolution.resolve(badRef)).toThrow()
  for (let round = 0; round < 2; round++) {
    expect(() => resolution.resolve(invalid.reference)).toThrow()
    expect(() => resolution.resolve({ ...badRef, outputRole: "duplicate" })).toThrow(
      "Topology candidates must have unique evaluation-local identifiers.",
    )
  }
  expect(resolution.resolve(good.reference)).toEqual({ status: "resolved", candidate: good })
  const excluded = { ...invalid, optionId: "excluded", reference: good.reference }
  const narrowed = prepareTreatmentReferenceResolution([good, excluded])
  expect(narrowed.resolve(good.reference, good.optionId)).toEqual({
    status: "resolved",
    candidate: good,
  })
  expect(() => narrowed.resolve(good.reference)).toThrow()
})

it("preserves missing display IDs and first matching display entry behavior", () => {
  const first = entry(candidate("edge"))
  const second = entry(candidate("edge", 2))
  const display = { ...first, candidateId: second.candidateId }
  expect(prepareTreatmentReferenceResolution([display, second]).resolve(second.reference)).toEqual({
    status: "resolved",
    candidate: display,
  })
  expect(
    prepareTreatmentReferenceResolution([{ ...first, candidateId: "missing" }]).resolve(
      first.reference,
    ),
  ).toEqual({ status: "missing" })
  expect(() => resolveTreatmentReference(first.reference, [first, first])).toThrow(
    "Topology candidates must have unique evaluation-local identifiers.",
  )
})

it("replaces prepared evidence explicitly without retaining old candidate identities or decisions", () => {
  const first = entry(candidate("edge"))
  const previous = prepareTreatmentReferenceResolution([first])
  expect(previous.resolve(first.reference)).toEqual({ status: "resolved", candidate: first })
  const replacement = { ...first, id: "replacement", label: "New generation" }
  const current = prepareTreatmentReferenceResolution([replacement])
  expect(current.resolve(first.reference)).toEqual({ status: "resolved", candidate: replacement })
  const coincident = entry({ ...first.candidate, candidateId: "coincident" })
  const ambiguous = prepareTreatmentReferenceResolution([replacement, coincident])
  expect(ambiguous.resolve(first.reference)).toEqual({ status: "ambiguous" })
  expect(previous.resolve(first.reference)).toEqual({ status: "resolved", candidate: first })
  expect(current.resolve(first.reference)).toEqual({ status: "resolved", candidate: replacement })
})

it("promotes and validates selected batches with one index per queried scope and retains authored references", () => {
  const options = [
    option(
      sourceId,
      "result",
      "Body",
      Array.from({ length: 128 }, (_, index) => candidate("edge", index + 1)),
    ),
  ]
  const entries = edgeTreatmentCandidates(
    options,
    geometry(options),
    (kind, ordinal) => `${kind} ${ordinal}`,
    "edge",
  )
  const values = {
    ...initialTreatmentValues(
      { kind: "create", createFeatureId: () => treatmentId, featureLabel: "Chamfer" },
      "chamfer",
      options,
      "mm",
    ),
    references: entries.map(({ reference }) => legacy(reference)),
  }
  const promotion = tracked(entries)
  const promoted = promoteTreatmentTargets(values, promotion.entries)
  expect(promoted.targets).toHaveLength(128)
  expect(promoted.references).toEqual(values.references)
  expect(promotion.reads()).toBe(128)
  const validation = tracked(entries)
  const context = {
    featureId: treatmentId,
    mode: { kind: "create" as const, createFeatureId: () => treatmentId, featureLabel: "Chamfer" },
    operation: "chamfer" as const,
    options,
    candidates: validation.entries,
    variables: [],
    unit: "mm" as const,
    copy: {
      ...copy,
      missingCatalogue: "catalogue",
      missingSideFace: "side",
      planarOnly: "planar",
      invalidAngle: "angle",
      invalidAdvancedRange: "range",
    },
  }
  expect(treatmentFeature(values, context).ok).toBe(true)
  expect(validation.reads()).toBe(128)
  const first = values.references[0]
  if (!first) throw new Error("The batch fixture requires selected references.")
  const duplicate = { ...values, references: [first, first] }
  const result = treatmentFeature(duplicate, context)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.feature.references).toEqual([first, first])
})

it("toggles resolved overrides across a batch without replacing unresolved authored intent", () => {
  const edges = Array.from({ length: 8 }, (_, index) => candidate("edge", index + 1))
  const options = [option(sourceId, "part.0", "Body", edges)]
  const entries = edgeTreatmentCandidates(options, geometry(options), () => "edge", "edge")
  const picked = entries[0]
  if (!picked) throw new Error("The override fixture requires a picked edge.")
  const directionOverrides = entries.map(({ reference }) => {
    const edge = bodyTopoRefSchema.parse(reference)
    if (edge.kind !== "edge") throw new Error("The override fixture requires edges.")
    return { ...edge, kind: "edge" as const }
  })
  const retained = directionOverrides[1]
  if (!retained) throw new Error("The override fixture requires a retained edge.")
  const missing = { ...retained, semanticRole: "absent" }
  const values = {
    ...initialTreatmentValues(
      { kind: "create", createFeatureId: () => treatmentId, featureLabel: "Chamfer" },
      "chamfer",
      options,
      "mm",
    ),
    directionOverrides: [...directionOverrides, missing],
  }
  const observed = tracked(entries)
  const result = applyTreatmentPick(
    values,
    {
      sequence: 1,
      featureId: treatmentId,
      reference: picked.reference,
      pick: { kind: "overrides" },
    },
    observed.entries,
    options,
  )
  expect("values" in result && result.values.directionOverrides).toEqual([
    ...directionOverrides.slice(1),
    missing,
  ])
  expect(observed.reads()).toBe(8)
})
