import { describe, expect, it } from "bun:test"
import { featureRecordSchema } from "./feature-graph"
import { featureIdSchema } from "./identifiers"
import {
  expectedLoftDependencyIds,
  loftFeatureParametersSchema,
  loftFeatureParametersV2Schema,
  loftFeatureType,
  loftFeatureTypeHandler,
  loftFeatureTypeV2,
  readLoftFeatureParameters,
} from "./part-design-loft"

const id = (value: number) => `018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`
const section = (value: number) => ({
  schemaVersion: 0,
  sketchId: id(value),
  outerBoundaryEntityIds: [id(50)],
  holeBoundaryEntityIds: [],
})
const parameters = { sections: [section(2), section(1)], ruled: false }

describe("ordered new-body Loft contract", () => {
  it("requires durable complete hole correspondence while preserving v1 replay", () => {
    const sections = [1, 2].map((value) => ({
      ...section(value),
      holeBoundaryEntityIds: [[id(51 + value)], [id(61 + value)]],
    }))
    const holeCorrespondence = [
      { sectionBoundaryEntityIds: [[id(52)], [id(53)]] },
      { sectionBoundaryEntityIds: [[id(62)], [id(63)]] },
    ]
    const params = loftFeatureParametersV2Schema.parse({
      sections,
      ruled: false,
      holeCorrespondence,
    })
    expect(readLoftFeatureParameters({ type: loftFeatureTypeV2.type, parameters: params })).toEqual(
      params,
    )
    for (const tracks of [
      [],
      holeCorrespondence.slice(0, 1),
      [holeCorrespondence[0], holeCorrespondence[0]],
      [{ sectionBoundaryEntityIds: [[id(52)], [id(99)]] }, holeCorrespondence[1]],
    ])
      expect(
        loftFeatureParametersV2Schema.safeParse({ ...params, holeCorrespondence: tracks }).success,
      ).toBe(false)
    expect(loftFeatureParametersSchema.safeParse({ sections, ruled: false }).success).toBe(false)
  })
  it.each([19, 24])("accepts %i ordered sections with bounded producer dependencies", (count) => {
    const sections = Array.from({ length: count }, (_, index) => section(index + 1))
    expect(loftFeatureParametersSchema.parse({ sections, ruled: true }).sections).toEqual<unknown>(
      sections,
    )
    expect(loftFeatureType.dependencies).toEqual({ min: 0, max: 24 })
  })
  it("retains section order as content identity and reads only its exact feature version", () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: id(10),
      type: loftFeatureType.type,
      parameters,
      dependencies: [],
      references: [],
      suppressed: false,
    })
    expect(readLoftFeatureParameters(feature)).toEqual<unknown>(parameters)
    expect(loftFeatureTypeHandler.contentParameters(feature.parameters)).toEqual(parameters)
    expect(
      readLoftFeatureParameters({ ...feature, type: { ...feature.type, schemaVersion: 2 } }),
    ).toBeNull()
    expect(
      loftFeatureTypeHandler.contentParameters({
        ...parameters,
        sections: [...parameters.sections].reverse(),
      }),
    ).not.toEqual(parameters)
  })
  it.each([
    { sections: [section(1)] },
    { sections: [section(1), section(1)] },
    { sections: Array.from({ length: 25 }, (_, index) => section(index + 1)) },
    { sections: [{ ...section(1), holeBoundaryEntityIds: [[id(51)]] }, section(2)] },
    {
      sections: [1, 2].map((value) => ({
        ...section(value),
        outerBoundaryEntityIds: Array.from({ length: 1_001 }, (_, index) => id(index + 100)),
      })),
    },
    { ruled: "smooth" },
    { operation: "add" },
  ])("rejects unsupported or over-budget input %j", (replacement) => {
    expect(loftFeatureParametersSchema.safeParse({ ...parameters, ...replacement }).success).toBe(
      false,
    )
  })
  it("deduplicates resolved support owners without sorting or consuming them", () => {
    const owners = [3, 1, 3, 2, 1].map((value) => featureIdSchema.parse(id(value)))
    expect(expectedLoftDependencyIds(owners)).toEqual<unknown>([id(3), id(1), id(2)])
  })
})
