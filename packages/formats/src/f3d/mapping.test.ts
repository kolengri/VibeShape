import { describe, expect, it } from "bun:test"
import { BODY } from "./decode/body"
import { Bytes, segment } from "./decode/test-segment"
import { mapF3dDesign } from "./index"
import {
  type F3dDesign,
  type F3dExtrude,
  type F3dSketchFeature,
  IDENTITY,
  readSegment,
} from "./model"

function design(): F3dDesign {
  return {
    parameters: [],
    userParameters: [],
    features: [],
    bodies: [],
    problems: [],
    unreadParameters: 0,
  }
}
function sketch(): F3dSketchFeature {
  return {
    id: 1,
    name: "Circle sketch",
    type: "sketch",
    kind: "Sketch",
    suppressed: false,
    parameters: [],
    sketch: {
      id: 2,
      frame: [...IDENTITY],
      points: [],
      lines: [],
      splines: [],
      texts: [],
      circulars: [
        {
          id: 3,
          center: [1, 2, 0],
          normal: [0, 0, 1],
          xAxis: [1, 0, 0],
          radius: 0.5,
          startAngle: 0,
          endAngle: 2 * Math.PI,
          centerPoint: 4,
          construction: false,
        },
      ],
    },
  }
}
function extrude(): F3dExtrude {
  return {
    id: 5,
    name: "Cylinder",
    type: "extrude",
    kind: "Extrude",
    suppressed: false,
    parameters: [
      {
        id: 6,
        number: 1,
        name: "d1",
        expression: "20 mm",
        kind: "AlongDistance",
        comment: "",
        user: false,
        unit: "mm",
        value: 2,
      },
    ],
    operation: "new-body",
    direction: "one-side",
    reversed: false,
    solid: true,
    start: "profile-plane",
    profiles: [{ id: 7, sketch: 2 }],
    faces: [],
    participants: [],
  }
}
describe("F3D conservative editable mapping", () => {
  it("normalizes centimeters and produces a cylinder candidate without assuming geometry success", () => {
    const result = mapF3dDesign({ ...design(), features: [sketch(), extrude()] }, "STEP", 1)
    expect(result.sketches[0]?.curves).toEqual([{ type: "circle", center: [10, 20], radius: 5 }])
    expect(result.cylinder).toEqual({
      sketchRecord: 2,
      name: "Cylinder",
      x: 10,
      y: 20,
      radius: 5,
      distance: 20,
    })
    expect(result.report.unsupported[0]?.reason).toContain(
      "only when source-body measurements confirm",
    )
  })
  it("does not replay tapered, offset, reversed or participant extrusions", () => {
    for (const feature of [
      { ...extrude(), reversed: true },
      { ...extrude(), start: "face" as const },
      { ...extrude(), operation: "cut" as const },
      {
        ...extrude(),
        parameters: [
          ...extrude().parameters,
          { ...extrude().parameters[0]!, kind: "TaperAngle", value: 0.1 },
        ],
      },
    ]) {
      const result = mapF3dDesign({ ...design(), features: [sketch(), feature] }, "STEP", 1)
      expect(result.cylinder).toBeNull()
      expect(result.report.unsupported.some((issue) => issue.name === "Cylinder")).toBe(true)
    }
  })
  it("reports unsupported sketch placement and constraints instead of flattening or inventing links", () => {
    const translated = sketch()
    translated.sketch.frame[3] = 1
    const result = mapF3dDesign({ ...design(), features: [translated] }, "STEP", 1)
    expect(result.sketches).toEqual([])
    expect(result.report.unsupported[0]?.reason).toContain("untransformed XY")
  })
  it("copies numeric parameters as evaluated constants, never executable expressions", () => {
    const parameter = {
      ...extrude().parameters[0]!,
      name: "width",
      user: true,
      expression: "eval('malicious')",
      value: 1.5,
    }
    const result = mapF3dDesign(
      {
        ...design(),
        userParameters: [parameter, { ...parameter, name: "label", text: "hello", unit: "Text" }],
      },
      "STEP",
      1,
    )
    expect(result.parameters).toEqual([{ name: "width", expression: "15 mm" }])
    expect(result.report.unsupported.some((issue) => issue.name === "label")).toBe(true)
    expect(() =>
      mapF3dDesign(
        { ...design(), userParameters: [{ ...parameter, value: Number.NaN }] },
        "STEP",
        1,
      ),
    ).toThrow(/non-finite/)
  })
  it("prevents editable promotion after decoding problems or unknown feature history", () => {
    expect(
      mapF3dDesign(
        { ...design(), features: [sketch(), extrude()], problems: ["Missing feature"] },
        "STEP",
        1,
      ).cylinder,
    ).toBeNull()
    expect(
      mapF3dDesign({ ...design(), features: [sketch(), extrude()], unreadParameters: 1 }, "STEP", 1)
        .cylinder,
    ).toBeNull()
  })
})

it("reports an unrecognized body layout alongside supported bodies instead of silently omitting it", () => {
  const supported = new Bytes()
    .raw(new Array<number>(10).fill(0))
    .u32(1)
    .u32(0)
    .u32(0)
    .u8(1)
    .u8(1).out
  const decoded = readSegment(
    segment([
      { guid: BODY, id: 1, body: supported },
      { guid: BODY, id: 2, body: [0, 0] },
    ]),
  )
  expect(decoded.bodies.map(({ id }) => id)).toEqual([1])
  expect(decoded.problems).toEqual([
    "body #2: Unsupported body visibility/index layout; body omitted.",
  ])
  const plan = mapF3dDesign(decoded, "ISO-10303-21;", 1)
  expect(plan.report.recoveredBodies).toBe(1)
  expect(plan.report.unsupported).toContainEqual({
    name: "Design record",
    reason: "body #2: Unsupported body visibility/index layout; body omitted.",
  })
})
