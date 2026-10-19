import { describe, expect, it } from "bun:test"
import {
  extrusionFeatureContentParametersV6Schema,
  extrusionFeatureContentParametersV8Schema,
  featureEvaluationInputSchema,
} from "./geometry-worker"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
const frame = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] }
const endCondition = { kind: "distance" }
const profile = {
  outer: {
    sourceEntityIds: [id(1)],
    segments: [{ entityId: id(1), type: "circle", center: [0, 0], radius: 2 }],
  },
  holes: [],
}
const content = {
  sketchId: id(1),
  sketchIds: [id(1), id(2)],
  supportFeatureIds: [],
  frame,
  profiles: [
    { ...profile, frame, distance: 10, endCondition },
    {
      ...profile,
      frame: { origin: [20, 0, 3], xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] },
      distance: 10,
      endCondition,
    },
  ],
  distance: 10,
  symmetric: false,
  reversed: false,
  secondDistance: null,
  operation: "new",
  startOffset: 0,
  draftAngle: 0,
  endCondition,
}

describe("multi-sketch Extrude content contract", () => {
  it("requires an exact frame per profile without widening the v6 content decoder", () => {
    expect(extrusionFeatureContentParametersV8Schema.safeParse(content).success).toBe(true)
    expect(extrusionFeatureContentParametersV6Schema.safeParse(content).success).toBe(false)
    const { frame: _frame, ...missing } = content.profiles[0] ?? {}
    expect(
      extrusionFeatureContentParametersV8Schema.safeParse({ ...content, profiles: [missing] })
        .success,
    ).toBe(false)
    expect(
      extrusionFeatureContentParametersV8Schema.safeParse({ ...content, sketchIds: [id(2), id(1)] })
        .success,
    ).toBe(false)
    expect(
      extrusionFeatureContentParametersV8Schema.safeParse({
        ...content,
        supportFeatureIds: [id(3), id(3)],
      }).success,
    ).toBe(false)
  })
  it("rejects a profile that changes the shared end-support binding", () => {
    const end = {
      kind: "through-all",
      inputIndex: 9,
      sourceContentHash: "a".repeat(64),
      outputRole: "result",
    }
    const value = {
      ...content,
      endCondition: end,
      profiles: content.profiles.map((profile) => ({ ...profile, endCondition: end })),
    }
    expect(extrusionFeatureContentParametersV8Schema.safeParse(value).success).toBe(true)
    expect(
      extrusionFeatureContentParametersV8Schema.safeParse({
        ...value,
        profiles: [{ ...value.profiles[0], endCondition: { ...end, inputIndex: 8 } }],
      }).success,
    ).toBe(false)
  })
  it("admits up to 66 producer slots only for registered v8 Extrude", () => {
    const inputs = Array.from({ length: 66 }, () => "a".repeat(64))
    const dependencies = inputs.map((contentHash, index) => ({
      featureId: id(index + 100),
      contentHash,
    }))
    const request = {
      documentId: "multi-sketch-budget",
      featureId: id(200),
      contentHash: "b".repeat(64),
      dependencies,
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
      content: {
        schemaVersion: 0,
        feature: {
          schemaVersion: 0,
          type: {
            moduleId: "org.vibeshape.core.part-design",
            moduleVersion: "0.1.0",
            typeId: "org.vibeshape.feature.part-design.extrusion",
            schemaVersion: 8,
          },
          parameters: content,
          inputs,
          references: [],
        },
        environment: {
          schemaVersion: 0,
          hostApiVersion: "0.1.0",
          geometry: {
            adapterId: "org.vibeshape.geometry.replicad",
            adapterVersion: "0.1.0+test",
            kernelId: "org.opencascade.occt",
            kernelVersion: "7.8.1",
            kernelSourceRevision: "bb368e271e24f63078129283148ce83db6b9670a",
          },
          modelingTolerancePolicyVersion: 1,
          provider: { kind: "built-in" },
        },
      },
    }
    expect(featureEvaluationInputSchema.safeParse(request).success).toBe(true)
    expect(
      featureEvaluationInputSchema.safeParse({
        ...request,
        dependencies: [...dependencies, { featureId: id(500), contentHash: "a".repeat(64) }],
        content: {
          ...request.content,
          feature: { ...request.content.feature, inputs: [...inputs, "a".repeat(64)] },
        },
      }).success,
    ).toBe(false)
    expect(
      featureEvaluationInputSchema.safeParse({
        ...request,
        content: {
          ...request.content,
          feature: {
            ...request.content.feature,
            type: { ...request.content.feature.type, schemaVersion: 6 },
          },
        },
      }).success,
    ).toBe(false)
  })
})
