import {
  boxFeatureType,
  createLengthQuantity,
  type DocumentSnapshot,
  featureIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  FEATURE_DELETE_BLOCKER_PREVIEW_LIMIT,
  featureDeleteEligibility,
} from "./feature-delete-eligibility"

const id = (suffix: string) => featureIdSchema.parse(`0195b5ac-b220-7a2c-8c33-67a36a7f${suffix}`)

function snapshot(features: DocumentSnapshot["features"]): DocumentSnapshot {
  return { sketches: [], features } as unknown as DocumentSnapshot
}

function boxFeature(featureId: string, dependencies: string[] = []) {
  return {
    schemaVersion: 0 as const,
    id: id(featureId),
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(1),
      depth: createLengthQuantity(1),
      height: createLengthQuantity(1),
      centered: false,
    },
    dependencies: dependencies.map(id),
    references: [],
    suppressed: false,
  }
}

describe("featureDeleteEligibility", () => {
  it("returns feature dependency blockers", () => {
    const result = featureDeleteEligibility(
      snapshot([boxFeature("4101"), boxFeature("4102", ["4101"])]),
      id("4101"),
    )
    expect(result.unavailable).toBe(false)
    expect(result.blockers).toEqual([
      expect.objectContaining({
        dependent: { kind: "feature", id: id("4102") },
        relation: "feature-dependency",
      }),
    ])
  })

  it("fails closed when the dependency model is unavailable", () => {
    const result = featureDeleteEligibility(
      snapshot([
        {
          ...boxFeature("4101"),
          type: {
            moduleId: "org.vibeshape.test.module",
            moduleVersion: "1.0.0",
            typeId: "org.vibeshape.test.unknown",
            schemaVersion: 1,
          } as unknown as typeof boxFeatureType.type,
        },
      ]),
      id("4101"),
    )
    expect(result).toEqual({ blockers: [], blockerCount: 0, unavailable: true })
  })

  it("includes model-reference and feature-face support blockers", () => {
    const targetFeature = boxFeature("4110")
    const signature = {
      kind: "face" as const,
      geometryClass: "PLANE" as const,
      measure: 1,
      centroid: [0, 0, 0] as [number, number, number],
      bounds: {
        min: [0, 0, 0] as [number, number, number],
        max: [1, 1, 0] as [number, number, number],
      },
      direction: [0, 0, 1] as [number, number, number],
      directionMode: "oriented" as const,
      boundaryCount: 4,
      adjacentGeometryClasses: [],
    }
    const reference = {
      schemaVersion: 0 as const,
      featureId: targetFeature.id,
      kind: "face" as const,
      semanticRole: "test.face",
      signature,
    }
    const modelDependent = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id("4111"),
      label: "Model-dependent sketch",
      plane: "xy",
      entities: [],
      constraints: [],
      externalReferences: [
        {
          schemaVersion: 0,
          id: id("4112"),
          kind: "model-intersection",
          reference,
          projectedLineId: id("4113"),
          projectedStartPointId: id("4114"),
          projectedEndPointId: id("4115"),
        },
      ],
    })
    const supported = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: id("4116"),
      label: "Face-supported sketch",
      plane: "xy",
      entities: [],
      constraints: [],
      support: { kind: "feature-face", reference },
    })
    const result = featureDeleteEligibility(
      {
        sketches: [modelDependent, supported],
        features: [targetFeature],
      } as unknown as DocumentSnapshot,
      targetFeature.id,
    )
    expect(result.unavailable).toBe(false)
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependent: { kind: "sketch", id: modelDependent.id },
          relation: "feature-topology-reference",
        }),
        expect.objectContaining({
          dependent: { kind: "sketch", id: supported.id },
          relation: "sketch-support",
        }),
      ]),
    )
  })

  it("bounds the blocker preview while retaining the total count", () => {
    const source = boxFeature("4120")
    const dependents = Array.from(
      { length: FEATURE_DELETE_BLOCKER_PREVIEW_LIMIT + 3 },
      (_, index) => boxFeature(String(4121 + index), ["4120"]),
    )
    const result = featureDeleteEligibility(snapshot([source, ...dependents]), source.id)

    expect(result.unavailable).toBe(false)
    expect(result.blockers).toHaveLength(FEATURE_DELETE_BLOCKER_PREVIEW_LIMIT)
    expect(result.blockerCount).toBe(dependents.length)
  })
})
