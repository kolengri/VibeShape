import { describe, expect, it, spyOn } from "bun:test"
import { createLengthQuantity, featureIdSchema, filletFeatureType } from "@vibeshape/domain"
import { modelBodyTopologyEvidenceSchema } from "@vibeshape/domain/model-body-topology"
import { extrusionBodyOptions } from "./extrusion-body-options"
import { extrusionBodyFixture } from "./extrusion-body-test-fixtures"

function collect(fixture: ReturnType<typeof extrusionBodyFixture>, excluded?: string) {
  return extrusionBodyOptions(
    fixture.snapshot,
    fixture.rebuild,
    excluded,
    (name, role) => `${name} · ${role}`,
    () => "Legacy",
  )
}

function consumedBodyFixture() {
  const fixture = extrusionBodyFixture(undefined, false, "PLANE")
  if (!fixture.rebuild.ok) throw new Error("Expected exact geometry.")
  const producer = fixture.snapshot.features[0]
  const geometry = fixture.rebuild.response.geometry[0]
  if (!producer || !geometry) throw new Error("Expected a producer.")
  const consumer = {
    ...producer,
    id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000900"),
    type: filletFeatureType.type,
    parameters: { radius: createLengthQuantity(1) },
    dependencies: [producer.id],
    label: "Result",
  }
  fixture.snapshot.features.push(consumer)
  fixture.rebuild.response.evaluation.records.push({
    featureId: consumer.id,
    status: "succeeded",
    contentHash: geometry.contentHash,
  })
  fixture.rebuild.response.geometry.push({ ...geometry, featureId: consumer.id })
  return { fixture, producer, consumer }
}

function faceFixture(meshFaceIds: readonly (number | undefined)[]) {
  const fixture = extrusionBodyFixture(undefined, false, "PLANE")
  if (!fixture.rebuild.ok) throw new Error("Expected exact geometry.")
  const body = fixture.rebuild.response.geometry[0]?.geometry.bodies?.[0]
  const seed = body?.topologyCandidates[0]
  if (!body || !seed) throw new Error("Expected a planar face.")
  body.shape = { ...body.shape, faceCount: meshFaceIds.length }
  body.topologyCandidates = meshFaceIds.map((meshFaceId, index) => ({
    ...seed,
    candidateId: `face:${index}`,
    meshFaceId,
    signature: { ...seed.signature, measure: index + 1 },
  }))
  return { fixture, body }
}

describe("extrusion body catalogue preparation", () => {
  it("projects exact face references only for bodies retained after consumption", () => {
    const { fixture, consumer } = consumedBodyFixture()
    const parse = spyOn(modelBodyTopologyEvidenceSchema, "safeParse")
    try {
      const options = collect(fixture)
      expect(options.map(({ id }) => id)).toEqual([consumer.id])
      expect(options[0]?.faces?.[0]?.reference).toMatchObject({
        featureId: consumer.id,
        outputRole: "result",
        kind: "face",
      })
      expect(parse).toHaveBeenCalledTimes(1)
    } finally {
      parse.mockRestore()
    }
  })

  it("retains the source and its face when the consuming operation has no output", () => {
    const { fixture, producer, consumer } = consumedBodyFixture()
    if (!fixture.rebuild.ok) throw new Error("Expected exact geometry.")
    fixture.rebuild.response.geometry.pop()
    fixture.rebuild.response.evaluation.records[1] = {
      featureId: consumer.id,
      status: "blocked",
      blockedBy: [producer.id],
    }
    const options = collect(fixture)
    expect(options.map(({ id }) => id)).toEqual([producer.id])
    expect(options[0]?.faces).toHaveLength(1)
  })

  it("keeps the earlier body available when editing or suppressing its consumer", () => {
    const { fixture, producer, consumer } = consumedBodyFixture()
    expect(collect(fixture, consumer.id).map(({ id }) => id)).toEqual([producer.id])
    expect(collect(fixture, producer.id)).toEqual([])
    consumer.suppressed = true
    const options = collect(fixture)
    expect(options.map(({ id }) => id)).toEqual([producer.id])
    expect(options[0]?.faces).toHaveLength(1)
  })

  it("offers no target when body consumption cannot bind its declared input", () => {
    const { fixture, consumer } = consumedBodyFixture()
    consumer.dependencies = [featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000999")]
    expect(collect(fixture)).toEqual([])
  })
})

describe("extrusion graphical face identity", () => {
  it.each([
    { ids: [0, 3, 8], expected: [0, 3, 8] },
    { ids: [0, 0, 8], expected: [undefined, undefined, 8] },
    { ids: [undefined, 3, 8], expected: [undefined, 3, 8] },
  ])("preserves stable references with graphical IDs $ids", ({ ids, expected }) => {
    const { fixture } = faceFixture(ids)
    const faces = collect(fixture)[0]?.faces
    expect(faces?.map(({ meshFaceId }) => meshFaceId)).toEqual([...expected])
    expect(faces?.map(({ reference }) => reference.signature.measure)).toEqual([1, 2, 3])
  })

  it("does not reuse graphical identity after the same input objects are replaced in place", () => {
    const { fixture, body } = faceFixture([1, 2])
    expect(collect(fixture)[0]?.faces?.map(({ meshFaceId }) => meshFaceId)).toEqual([1, 2])
    const second = body.topologyCandidates[1]
    if (!second) throw new Error("Expected a second face.")
    second.meshFaceId = 1
    expect(collect(fixture)[0]?.faces?.map(({ meshFaceId }) => meshFaceId)).toEqual([
      undefined,
      undefined,
    ])
  })

  it.each(["duplicate-candidate-id", "coincident-signature", "wrong-kind", "wrong-count"])(
    "retains fail-closed exact evidence checks for %s",
    (invalid) => {
      const { fixture, body } = faceFixture([1, 2])
      const [first, second] = body.topologyCandidates
      if (!first || !second) throw new Error("Expected two faces.")
      if (invalid === "duplicate-candidate-id") second.candidateId = first.candidateId
      if (invalid === "coincident-signature") second.signature = first.signature
      if (invalid === "wrong-kind") second.signature.kind = "edge"
      if (invalid === "wrong-count") body.shape.faceCount = 3
      expect(collect(fixture)[0]?.faces).toEqual([])
    },
  )
})
