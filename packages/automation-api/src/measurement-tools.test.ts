import { describe, expect, it } from "bun:test"
import { bodyTopoRefSchema } from "@vibeshape/domain/model-body-topology"
import {
  measurementOperationSchema,
  measurementResultContextMatches,
  measurementToolInputs,
  measurementViewSchema,
} from "./measurement-tools"

const id = (n: number) => `0195b5ac-b280-7a2c-8c33-${String(n).padStart(12, "0")}`
const reference = bodyTopoRefSchema.parse({
  schemaVersion: 1,
  featureId: id(2),
  outputRole: "split.positive",
  kind: "edge",
  semanticRole: "side",
  signature: {
    kind: "edge",
    geometryClass: "LINE",
    measure: 10,
    centroid: [5, 0, 0],
    bounds: { min: [0, 0, 0], max: [10, 0, 0] },
    direction: [1, 0, 0],
    directionMode: "axis",
    boundaryCount: 2,
    adjacentGeometryClasses: [],
  },
})
const target = { reference }
const argumentsValue = { source: "model", revision: 4, targets: [target] }
function operation(overrides: Record<string, unknown> = {}) {
  return { tool: "measure_model", arguments: { ...argumentsValue, ...overrides } }
}
function value(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    documentId: id(1),
    revision: 4,
    generation: 7,
    source: "model",
    targets: [
      {
        ...target,
        pointKind: "centroid",
        geometryClass: "LINE",
        lengthMm: 10,
        radiusMm: null,
        diameterMm: null,
        direction: [1, 0, 0],
        pointMm: [5, 0, 0],
      },
    ],
    pair: null,
    ...overrides,
  }
}

describe("precise topology measurement contract", () => {
  it("accepts one or two body-bound stable references and defaults to their centroids", () => {
    expect(measurementOperationSchema.parse(operation()).arguments.targets[0]?.pointKind).toBe(
      "centroid",
    )
    expect(
      measurementToolInputs.measure_model.safeParse({
        ...argumentsValue,
        targets: [target, { reference, pointKind: "end" }],
      }).success,
    ).toBe(true)
    expect(
      measurementOperationSchema.safeParse(operation({ source: "draft", draftId: id(10) })).success,
    ).toBe(true)
  })

  it.each([
    { targets: [] },
    { targets: [target, target, target] },
    { revision: -1 },
    { revision: 4.5 },
    { revision: undefined },
    { source: "preview" },
    { draftId: id(10) },
    { source: "draft" },
    { source: "draft", draftId: "invalid" },
    { targets: [{ candidateId: "edge:1" }] },
    { targets: [{ reference, coordinates: [1, 2, 3] }] },
    { targets: [{ reference, pointKind: "nearest" }] },
    { script: "return 1" },
  ])("rejects unbounded or untrusted query inputs: %j", (overrides) => {
    expect(measurementOperationSchema.safeParse(operation(overrides)).success).toBe(false)
  })

  it("requires the correct dimensional measure, finite values and explicit unavailable metrics", () => {
    expect(measurementViewSchema.safeParse(value()).success).toBe(true)
    const measured = value().targets[0]
    for (const overrides of [
      { lengthMm: undefined },
      { areaMm2: 1 },
      { lengthMm: Number.NaN },
      { direction: [Number.POSITIVE_INFINITY, 0, 0] },
      { radiusMm: undefined },
      { pointMm: [0, 0] },
    ]) {
      expect(
        measurementViewSchema.safeParse(value({ targets: [{ ...measured, ...overrides }] }))
          .success,
      ).toBe(false)
    }
    expect(
      measurementViewSchema.safeParse(
        value({
          pair: {
            pointDistanceMm: 2,
            directionAngleRad: null,
            parallelPlaneSeparationMm: null,
          },
        }),
      ).success,
    ).toBe(false)
    expect(
      measurementViewSchema.safeParse(value({ targets: [measured, measured], pair: null })).success,
    ).toBe(false)
    expect(
      measurementViewSchema.safeParse(
        value({
          targets: [measured, measured],
          pair: {
            pointDistanceMm: 2,
            directionAngleRad: Math.PI,
            parallelPlaneSeparationMm: null,
          },
        }),
      ).success,
    ).toBe(false)
  })
})

describe("measurement result context correlation", () => {
  it("matches normalized targets for local and remote consumers", () => {
    expect(measurementResultContextMatches(operation(), { ok: true, value: value() }, id(1))).toBe(
      true,
    )
    expect(measurementResultContextMatches(operation(), { ok: false }, id(1))).toBe(true)
    expect(measurementResultContextMatches({ tool: "model_info" }, { ok: true })).toBeNull()
    const draftOperation = operation({ source: "draft", draftId: id(10) })
    expect(
      measurementResultContextMatches(
        draftOperation,
        { ok: true, value: value({ source: "draft", draftId: id(10) }) },
        id(1),
      ),
    ).toBe(true)
  })

  it.each([
    { revision: 5 },
    { documentId: id(3) },
    { source: "draft", draftId: id(10) },
    { targets: [] },
    { targets: [{ ...value().targets[0], pointKind: "end" }] },
    { targets: [{ ...value().targets[0], reference: { ...reference, outputRole: "result" } }] },
    { targets: [{ ...value().targets[0], reference: { ...reference, featureId: id(3) } }] },
    {
      targets: [
        {
          ...value().targets[0],
          reference: { ...reference, signature: { ...reference.signature, measure: 12 } },
        },
      ],
    },
  ])("rejects a result for another request: %j", (overrides) => {
    expect(
      measurementResultContextMatches(operation(), { ok: true, value: value(overrides) }, id(1)),
    ).toBe(false)
  })

  it("rejects a different draft, different target order and oversized responses", () => {
    expect(
      measurementResultContextMatches(
        operation({ source: "draft", draftId: id(10) }),
        { ok: true, value: value({ source: "draft", draftId: id(11) }) },
        id(1),
      ),
    ).toBe(false)
    const first = value().targets[0]
    const second = { ...first, reference: { ...reference, outputRole: "result" }, pointKind: "end" }
    expect(
      measurementResultContextMatches(
        operation({ targets: [target, { reference: second.reference, pointKind: "end" }] }),
        {
          ok: true,
          value: value({
            targets: [second, first],
            pair: {
              pointDistanceMm: 10,
              directionAngleRad: 0,
              parallelPlaneSeparationMm: null,
            },
          }),
        },
        id(1),
      ),
    ).toBe(false)
    expect(
      measurementResultContextMatches(
        operation(),
        { ok: true, value: { ...value(), padding: "x".repeat(128 * 1024) } },
        id(1),
      ),
    ).toBe(false)
  })
})
