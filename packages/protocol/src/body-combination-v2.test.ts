import { describe, expect, it } from "bun:test"
import { featureContentIdentitySchema, featureEvaluationInputSchema } from "./geometry-worker"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const hash = "a".repeat(64)
function content() {
  return {
    schemaVersion: 2,
    environment: {
      schemaVersion: 0,
      hostApiVersion: "0.1.0",
      modelingTolerancePolicyVersion: 1,
      provider: { kind: "built-in" },
      geometry: {
        adapterId: "org.vibeshape.geometry.replicad",
        adapterVersion: "test",
        kernelId: "org.opencascade.occt",
        kernelVersion: "7.8.1",
        kernelSourceRevision: null,
      },
    },
    feature: {
      schemaVersion: 0,
      type: {
        moduleId: "org.vibeshape.core.part-design",
        moduleVersion: "0.1.0",
        typeId: "org.vibeshape.feature.part-design.union",
        schemaVersion: 2,
      },
      parameters: {},
      inputs: [hash],
      references: [],
      inputSlots: [0, 1].map((index) => ({
        inputIndex: 0,
        contentHash: hash,
        outputRole: `pattern.instance.${index}`,
      })),
    },
  }
}
function input() {
  return {
    documentId: "body-slot-protocol",
    featureId: id(5),
    content: content(),
    contentHash: "c".repeat(64),
    dependencies: [{ featureId: id(2), contentHash: hash }],
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}
describe("canonical version 2 ordered body slot protocol", () => {
  it("validates multiple exact role slots from one unique producer", () => {
    const parsed = featureEvaluationInputSchema.parse(input())
    expect(parsed.dependencies).toHaveLength(1)
    expect(parsed.content).toMatchObject({
      schemaVersion: 2,
      feature: {
        inputSlots: [
          { inputIndex: 0, outputRole: "pattern.instance.0" },
          { inputIndex: 0, outputRole: "pattern.instance.1" },
        ],
      },
    })
  })
  it.each([
    { inputIndex: 1, contentHash: hash, outputRole: "pattern.instance.1" },
    { inputIndex: 0, contentHash: "b".repeat(64), outputRole: "pattern.instance.1" },
    { inputIndex: 0, contentHash: hash, outputRole: "" },
    { inputIndex: 0, contentHash: hash, outputRole: "pattern.instance.0" },
    { inputIndex: 0, contentHash: hash, outputRole: "pattern.instance.1", featureId: id(2) },
  ])("rejects invalid, duplicate or UUID-bearing slots %j", (slot) => {
    const value = content()
    value.feature.inputSlots[1] = slot
    expect(featureContentIdentitySchema.safeParse(value).success).toBe(false)
  })
  it("rejects unused producer entries and producer-level role collapse", () => {
    const value = content()
    value.feature.inputs.push("b".repeat(64))
    expect(featureContentIdentitySchema.safeParse(value).success).toBe(false)
    const request = input()
    expect(
      featureEvaluationInputSchema.safeParse({
        ...request,
        dependencies: [{ ...request.dependencies[0], outputRole: "pattern.instance.1" }],
      }).success,
    ).toBe(false)
  })
  it("keeps canonical hash order and unique producer IDs mandatory", () => {
    const value = content()
    value.feature.inputs.push("b".repeat(64))
    value.feature.inputSlots[1] = {
      inputIndex: 1,
      contentHash: "b".repeat(64),
      outputRole: "result",
    }
    const request = {
      ...input(),
      content: value,
      dependencies: [
        { featureId: id(2), contentHash: hash },
        { featureId: id(3), contentHash: "b".repeat(64) },
      ],
    }
    expect(featureEvaluationInputSchema.safeParse(request).success).toBe(true)
    expect(
      featureEvaluationInputSchema.safeParse({
        ...request,
        dependencies: request.dependencies.map((dep) => ({ ...dep, featureId: id(2) })),
      }).success,
    ).toBe(false)
    expect(
      featureEvaluationInputSchema.safeParse({
        ...request,
        dependencies: [...request.dependencies].reverse(),
      }).success,
    ).toBe(false)
    expect(featureEvaluationInputSchema.safeParse({ ...request, featureId: id(2) }).success).toBe(
      false,
    )
  })
})
