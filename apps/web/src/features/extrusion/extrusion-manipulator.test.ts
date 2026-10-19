import { describe, expect, it } from "bun:test"
import {
  createLengthQuantity,
  createSketchProfileSet,
  extrusionEndConditionSchema,
  featureIdSchema,
  sketchProfileSelectorSchema,
} from "@vibeshape/domain"
import {
  type ViewerFrame,
  type ViewerSketch,
  type ViewerSketchProfile,
  type ViewerVector3,
  viewerSketchProfileKey,
} from "@vibeshape/viewer/three-viewport"
import type { ExtrusionDistanceRequest } from "./extrusion-distance-manipulator"
import { createExtrusionManipulator, extrusionProfileCentroid } from "./extrusion-manipulator"

type ExtrusionParameters = Parameters<typeof createExtrusionManipulator>[1]

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6201")
const otherFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6202")
const selector = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f6101",
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f6111"],
  holeBoundaryEntityIds: [],
})
const otherSelector = sketchProfileSelectorSchema.parse({
  ...selector,
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f6112"],
})
const otherSketchSelector = sketchProfileSelectorSchema.parse({
  ...selector,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f6102",
})
const xy: ViewerFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
}
const rootHalf = Math.SQRT1_2
const tilted: ViewerFrame = {
  origin: [100, -50, 20],
  xAxis: [0, 1, 0],
  yAxis: [-rootHalf, 0, rootHalf],
  normal: [rootHalf, 0, rootHalf],
}

function parameters(overrides: Partial<ExtrusionParameters> = {}): ExtrusionParameters {
  return {
    profile: selector,
    distance: createLengthQuantity(12),
    secondDistance: null,
    symmetric: false,
    reversed: false,
    operation: "new",
    ...overrides,
  }
}

function profile(outer: readonly number[], holes: readonly (readonly number[])[] = []) {
  return {
    selector,
    outerPositions: new Float32Array(outer),
    holePositions: holes.map((hole) => new Float32Array(hole)),
  } satisfies ViewerSketchProfile
}

const rectangle = profile([10, 20, 18, 20, 18, 24, 10, 24])

function sketch(
  profiles: readonly ViewerSketchProfile[] = [rectangle],
  frame: ViewerFrame = xy,
): ViewerSketch {
  return {
    sketchId: selector.sketchId,
    frame,
    profiles,
    curvePositions: new Float32Array(),
    constructionCurvePositions: new Float32Array(),
    pointPositions: new Float32Array(),
    constructionPointPositions: new Float32Array(),
  }
}

function manipulator(
  id: typeof featureId,
  values: ExtrusionParameters,
  display: ViewerSketch | null,
  request: ExtrusionDistanceRequest | null,
) {
  const centroid = extrusionProfileCentroid(display, viewerSketchProfileKey(values.profile))
  return createExtrusionManipulator(id, values, centroid, display?.frame, request)
}

function expectVector(actual: ViewerVector3 | undefined, expected: ViewerVector3) {
  expect(actual).toBeDefined()
  for (let index = 0; index < 3; index++) {
    expect(actual?.[index]).toBeCloseTo(expected[index] ?? 0, 5)
  }
}

describe("Extrusion manipulator profile anchoring", () => {
  it("centers an offset rectangle instead of using its sketch origin", () => {
    const result = manipulator(featureId, parameters(), sketch(), null)
    expectVector(result?.origin, [14, 22, 0])
    expectVector(result?.direction, [0, 0, 1])
    expect(result).toMatchObject({ distance: 12, distanceScale: 1, secondDistance: null })
  })

  it("centers an offset sampled circle", () => {
    const circle = profile(
      Array.from({ length: 64 }, (_, index) => {
        const angle = (index * Math.PI * 2) / 64
        return [-12 + 3 * Math.cos(angle), 8 + 3 * Math.sin(angle)]
      }).flat(),
    )
    const result = manipulator(featureId, parameters(), sketch([circle]), null)
    expectVector(result?.origin, [-12, 8, 0])
  })

  it("maps the profile centroid and signed start offset through a tilted support", () => {
    const result = manipulator(
      featureId,
      parameters({ startOffset: createLengthQuantity(3) }),
      sketch([rectangle], tilted),
      null,
    )
    expectVector(result?.origin, [100 - 19 * rootHalf, -36, 20 + 25 * rootHalf])
    expectVector(result?.direction, [rootHalf, 0, rootHalf])
  })

  it("preserves small local profiles on distant support origins", () => {
    const small = profile([1, 2, 1.03125, 2, 1.03125, 2.0625, 1, 2.0625])
    const frame: ViewerFrame = { ...xy, origin: [1e10, 2e10, -3e10] }
    const result = manipulator(featureId, parameters(), sketch([small], frame), null)
    expectVector(result?.origin, [1e10 + 1.015625, 2e10 + 2.03125, -3e10])
  })

  it("weights unequal triangles by area rather than averaging vertices or bounds", () => {
    const trapezoid = profile([0, 0, 6, 0, 2, 3, 0, 3])
    const result = manipulator(featureId, parameters(), sketch([trapezoid]), null)
    expectVector(result?.origin, [13 / 6, 1.25, 0])
  })

  it("accounts for a concave region and its off-center hole", () => {
    const region = profile(
      [0, 0, 6, 0, 6, 2, 2, 2, 2, 6, 0, 6],
      [[0.5, 0.5, 1.5, 0.5, 1.5, 1.5, 0.5, 1.5]],
    )
    const result = manipulator(featureId, parameters(), sketch([region]), null)
    expectVector(result?.origin, [43 / 19, 43 / 19, 0])
  })

  it("subtracts an asymmetric hole's area from the centroid", () => {
    const region = profile([0, 0, 12, 0, 12, 8, 0, 8], [[1, 1, 5, 1, 5, 3, 1, 3]])
    const result = manipulator(featureId, parameters(), sketch([region]), null)
    expectVector(result?.origin, [69 / 11, 46 / 11, 0])
  })

  it("retains the mathematical area centroid when it lies inside a hole", () => {
    const ring = profile([0, 0, 10, 0, 10, 10, 0, 10], [[3, 3, 7, 3, 7, 7, 3, 7]])
    const result = manipulator(featureId, parameters(), sketch([ring]), null)
    expectVector(result?.origin, [5, 5, 0])
  })

  it("anchors only the normalized primary selector regardless of display or selection order", () => {
    const other = { ...profile([-40, -40, -20, -40, -20, -20, -40, -20]), selector: otherSelector }
    const result = manipulator(
      featureId,
      parameters({
        profiles: createSketchProfileSet([otherSketchSelector, otherSelector, selector]),
      }),
      sketch([other, rectangle], tilted),
      null,
    )
    expectVector(result?.origin, [100 - 22 * rootHalf, -36, 20 + 22 * rootHalf])
    expectVector(result?.direction, [rootHalf, 0, rootHalf])
  })

  it("reuses a local centroid while independently projecting frame, depth, reverse, and offset", () => {
    const centroid = extrusionProfileCentroid(sketch(), viewerSketchProfileKey(selector))
    expect(centroid?.position).toEqual([14, 22])
    const request = { featureId, distance: 20, sequence: 1 }
    const result = createExtrusionManipulator(
      featureId,
      parameters({ reversed: true, startOffset: createLengthQuantity(3) }),
      centroid,
      tilted,
      request,
    )
    expectVector(result?.origin, [100 - 19 * rootHalf, -36, 20 + 25 * rootHalf])
    expectVector(result?.direction, [-rootHalf, 0, -rootHalf])
    expect(result).toMatchObject({ distance: 20, distanceScale: 1 })
    const symmetric = createExtrusionManipulator(
      featureId,
      parameters({ symmetric: true, startOffset: createLengthQuantity(-4) }),
      centroid,
      xy,
      request,
    )
    expectVector(symmetric?.origin, [14, 22, -4])
    expect(symmetric).toMatchObject({ distance: 10, distanceScale: 2 })
  })

  it("rejects a retained centroid belonging to a different primary selector", () => {
    const centroid = extrusionProfileCentroid(sketch(), viewerSketchProfileKey(selector))
    expect(
      createExtrusionManipulator(
        featureId,
        parameters({ profile: otherSelector }),
        centroid,
        xy,
        null,
      ),
    ).toBeNull()
  })

  it.each(["through-all", "up-to-body", "up-to-face"] as const)(
    "hides the ignored fallback distance in %s mode and restores the distance control",
    (kind) => {
      const targetBody = { schemaVersion: 0, featureId: otherFeatureId, outputRole: "result" }
      const endCondition = extrusionEndConditionSchema.parse({
        kind,
        targetBody,
        sourceContentHash: "a".repeat(64),
        ...(kind === "up-to-face"
          ? {
              face: {
                ...targetBody,
                schemaVersion: 1,
                kind: "face",
                signature: {
                  kind: "face",
                  geometryClass: "PLANE",
                  measure: 100,
                  centroid: [0, 0, 20],
                  bounds: { min: [-5, -5, 20], max: [5, 5, 20] },
                  boundaryCount: 1,
                  adjacentGeometryClasses: [],
                },
              },
            }
          : {}),
      })
      const centroid = extrusionProfileCentroid(sketch(), viewerSketchProfileKey(selector))
      const request = { featureId, distance: 20, sequence: 1 }
      expect(
        createExtrusionManipulator(featureId, parameters({ endCondition }), centroid, xy, request),
      ).toBeNull()
      const restored = createExtrusionManipulator(
        featureId,
        parameters({ endCondition: { kind: "distance" } }),
        centroid,
        xy,
        request,
      )
      expectVector(restored?.origin, [14, 22, 0])
      expect(restored).toMatchObject({ distance: 20, distanceScale: 1 })
    },
  )

  it("hides the control if the primary profile is missing instead of using another profile", () => {
    const other = { ...rectangle, selector: otherSelector }
    expect(
      manipulator(
        featureId,
        parameters({ profiles: createSketchProfileSet([selector, otherSelector]) }),
        sketch([other]),
        null,
      ),
    ).toBeNull()
  })

  it("rejects another sketch instead of averaging or substituting its support normal", () => {
    const otherSketch: ViewerSketch = {
      ...sketch([{ ...rectangle, selector: otherSketchSelector }], tilted),
      sketchId: otherSketchSelector.sketchId,
    }
    expect(manipulator(featureId, parameters(), otherSketch, null)).toBeNull()
  })

  it.each([
    { reversed: false, symmetric: false, second: null, offset: 4, depth: 12 },
    { reversed: true, symmetric: false, second: 3, offset: 4, depth: 12 },
    { reversed: false, symmetric: false, second: 3, offset: -4, depth: 12 },
    { reversed: false, symmetric: true, second: null, offset: 4, depth: 6 },
    { reversed: true, symmetric: true, second: null, offset: -4, depth: 6 },
  ])("preserves depth semantics for %j", ({ reversed, symmetric, second, offset, depth }) => {
    const result = manipulator(
      featureId,
      parameters({
        reversed,
        symmetric,
        secondDistance: second === null ? null : createLengthQuantity(second),
        startOffset: createLengthQuantity(offset),
      }),
      sketch(),
      null,
    )
    expectVector(result?.origin, [14, 22, offset])
    expectVector(result?.direction, [0, 0, reversed ? -1 : 1])
    expect(result).toMatchObject({
      distance: depth,
      distanceScale: symmetric ? 2 : 1,
      secondDistance: second,
    })
  })

  it("keeps first and second distance requests independent and preserves symmetric input scaling", () => {
    const request: ExtrusionDistanceRequest = { featureId, distance: 20, sequence: 1 }
    const twoSided = parameters({ secondDistance: createLengthQuantity(3) })
    expect(manipulator(featureId, twoSided, sketch(), request)).toMatchObject({
      distance: 20,
      secondDistance: 3,
    })
    expect(
      manipulator(featureId, twoSided, sketch(), { ...request, side: "second" }),
    ).toMatchObject({ distance: 12, secondDistance: 20 })
    expect(
      manipulator(featureId, twoSided, sketch(), {
        ...request,
        featureId: otherFeatureId,
      }),
    ).toMatchObject({ distance: 12, secondDistance: 3 })
    expect(
      manipulator(featureId, parameters({ symmetric: true }), sketch(), request),
    ).toMatchObject({ distance: 10, distanceScale: 2 })
  })

  it.each([
    profile([]),
    profile([0, 0, 1, 1, 2, 2]),
    profile([0, 0, 0, 0, 0, 0]),
    profile([0, 0, 1, 0, Number.NaN, 1]),
    profile([0, 0, 1, 0, 1]),
    profile([0, 0, 1, 0, 1, 1], [[]]),
  ])("hides invalid or degenerate profile geometry %#", (invalid) => {
    expect(manipulator(featureId, parameters(), sketch([invalid]), null)).toBeNull()
  })

  it("hides during missing display or invalid frame states", () => {
    expect(manipulator(featureId, parameters(), null, null)).toBeNull()
    expect(manipulator(featureId, parameters(), sketch([]), null)).toBeNull()
    const { frame, ...withoutFrame } = sketch()
    expect(frame).toBeDefined()
    expect(manipulator(featureId, parameters(), withoutFrame, null)).toBeNull()
    expect(
      manipulator(featureId, parameters(), sketch([rectangle], { ...xy, normal: [0, 0, 0] }), null),
    ).toBeNull()
  })

  it("rejects non-finite support origins and start offsets", () => {
    expect(
      manipulator(
        featureId,
        parameters(),
        sketch([rectangle], { ...xy, origin: [Number.NaN, 0, 0] }),
        null,
      ),
    ).toBeNull()
    expect(
      manipulator(
        featureId,
        parameters({ startOffset: { ...createLengthQuantity(0), value: Number.NaN } }),
        sketch(),
        null,
      ),
    ).toBeNull()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    "hides invalid transient requested depths %s",
    (distance) => {
      const request = { featureId, distance, sequence: 1 }
      expect(manipulator(featureId, parameters(), sketch(), request)).toBeNull()
      expect(
        manipulator(featureId, parameters({ secondDistance: createLengthQuantity(3) }), sketch(), {
          ...request,
          side: "second",
        }),
      ).toBeNull()
    },
  )
})
