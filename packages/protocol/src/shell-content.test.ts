import { describe, expect, it } from "bun:test"
import {
  shellFeatureContentParametersSchema,
  shellFeatureContentParametersV2Schema,
} from "./geometry-worker"

const opening = {
  schemaVersion: 1,
  kind: "face",
  outputRole: "result",
  signature: {
    kind: "face",
    geometryClass: "plane",
    measure: 25,
    centroid: [0, 0, 10],
    bounds: { min: [-2.5, -2.5, 10], max: [2.5, 2.5, 10] },
    boundaryCount: 4,
    adjacentGeometryClasses: [],
  },
}
const parameters = {
  thickness: 1,
  direction: "inward",
  sourceContentHash: "a".repeat(64),
  openings: [opening],
}
describe("Shell v1 worker content", () => {
  it("accepts only explicit direction, positive thickness and stable body-scoped face signatures", () => {
    expect(shellFeatureContentParametersSchema.parse(parameters)).toEqual<unknown>(parameters)
    expect(
      shellFeatureContentParametersSchema.safeParse({ ...parameters, thickness: -1 }).success,
    ).toBe(false)
    expect(
      shellFeatureContentParametersSchema.safeParse({ ...parameters, direction: "auto" }).success,
    ).toBe(false)
    expect(
      shellFeatureContentParametersSchema.safeParse({ ...parameters, openings: [] }).success,
    ).toBe(false)
    expect(
      shellFeatureContentParametersSchema.safeParse({
        ...parameters,
        openings: [{ ...opening, candidateId: "face:2" }],
      }).success,
    ).toBe(false)
    expect(
      shellFeatureContentParametersSchema.safeParse({
        ...parameters,
        openings: [{ ...opening, featureId: "document-local-id" }],
      }).success,
    ).toBe(false)
    expect(
      shellFeatureContentParametersSchema.safeParse({
        ...parameters,
        openings: [{ ...opening, signature: { ...opening.signature, kind: "edge" } }],
      }).success,
    ).toBe(false)
  })
})
describe("Shell v2 worker content", () => {
  it("allows an explicit closed cavity without weakening v1 or accepting native face identities", () => {
    const closed = { ...parameters, openings: [] }
    expect(shellFeatureContentParametersV2Schema.parse(closed)).toEqual<unknown>(closed)
    expect(shellFeatureContentParametersSchema.safeParse(closed).success).toBe(false)
    expect(
      shellFeatureContentParametersV2Schema.safeParse({
        ...parameters,
        openings: Array.from({ length: 65 }, () => opening),
      }).success,
    ).toBe(false)
    expect(
      shellFeatureContentParametersV2Schema.safeParse({
        ...parameters,
        openings: [{ ...opening, meshFaceId: 1 }],
      }).success,
    ).toBe(false)
  })
})
