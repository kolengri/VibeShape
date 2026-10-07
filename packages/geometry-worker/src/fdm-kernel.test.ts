// @vitest-environment node
import type { FdmFeatureContentParameters } from "@vibeshape/protocol"
import { type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { inspectOcctBody } from "./occt-body-validation"
import { createOcctFdmFeature } from "./occt-fdm"
import { createOcctBox, createOcctCylinder, cutOcctShapes } from "./occt-shapes"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const fs = await vi.importActual<{ readFileSync(path: URL): Uint8Array }>("node:fs")
  const bytes = fs.readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    { wasmBinary: bytes, locateFile: () => "replicad_single.wasm" },
  ])
  setOC(occt)
})
const common = { axis: "Z", origin: { x: 0, y: 0, z: 0 } } as const
const frame: Extract<FdmFeatureContentParameters, { kind: "web" }>["frame"] = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
}
function requireBody(shape: Shape3D) {
  const metrics = inspectOcctBody(occt, shape)
  expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
  expect(metrics.volume).toBeGreaterThan(0)
  return metrics
}
function cavity() {
  const outer = createOcctBox(occt, [30, 30, 10])
  const inner = createOcctBox(occt, [24, 24, 10], false, [0, 0, 2])
  try {
    return cutOcctShapes(occt, outer, inner)
  } finally {
    inner.delete()
    outer.delete()
  }
}
describe("exact FDM geometry invariants", () => {
  it.each([
    {
      parameters: { ...common, kind: "corner-relief", radius: 2, depth: 7 },
      removed: Math.PI * 4 * 7,
    },
    { parameters: { ...common, kind: "seam-groove", width: 2, depth: 2, length: 20 }, removed: 40 },
    {
      parameters: { ...common, kind: "nut-pocket", acrossFlats: 8, clearance: 0.2, depth: 5 },
      removed: (Math.sqrt(3) / 2) * 8.4 ** 2 * 5,
    },
    {
      parameters: { ...common, kind: "insert-pocket", diameter: 6, clearance: 0.2, depth: 5 },
      removed: Math.PI * 3.2 ** 2 * 5,
    },
  ] satisfies { parameters: FdmFeatureContentParameters; removed: number }[])(
    "cuts the analytical $parameters.kind volume and preserves its source",
    ({ parameters, removed }) => {
      const source = createOcctBox(occt, [60, 60, 20])
      let output: Shape3D | undefined
      try {
        output = createOcctFdmFeature(occt, parameters, source)
        expect(requireBody(output).volume).toBeCloseTo(72_000 - removed, 6)
        expect(requireBody(source).volume).toBeCloseTo(72_000, 7)
        expect(output.wrapped.IsPartner(source.wrapped)).toBe(false)
      } finally {
        output?.delete()
        source.delete()
      }
    },
  )
  it.each([false, true])(
    "makes an exact circular teardrop with tangent roof and flatTop=%s",
    (flatTop) => {
      const source = createOcctBox(occt, [30, 30, 10])
      let output: Shape3D | undefined
      try {
        const r = 3,
          angle = Math.PI / 4,
          apex = r / Math.cos(angle)
        const area =
          r ** 2 * (Math.PI - angle + Math.tan(angle)) -
          (flatTop ? (apex - r) ** 2 / Math.tan(angle) : 0)
        output = createOcctFdmFeature(
          occt,
          { ...common, kind: "teardrop-hole", diameter: 6, depth: 10, roofAngle: angle, flatTop },
          source,
        )
        expect(requireBody(output).volume).toBeCloseTo(9000 - area * 10, 5)
        const faces = output.faces
        try {
          expect(faces.filter((face) => face.geomType === "CYLINDRE").length).toBeGreaterThan(0)
        } finally {
          for (const face of faces) face.delete()
        }
      } finally {
        output?.delete()
        source.delete()
      }
    },
  )
  it("cuts a hexagonal seat with six compliant radial relief slots", () => {
    const source = createOcctBox(occt, [30, 30, 10])
    let output: Shape3D | undefined
    try {
      output = createOcctFdmFeature(
        occt,
        { ...common, kind: "hex-seat", acrossFlats: 8, depth: 5, compliance: 2, slotWidth: 0.5 },
        source,
      )
      expect(requireBody(output).volume).toBeLessThan(9000 - (Math.sqrt(3) / 2) * 8 ** 2 * 5)
      expect(requireBody(source).volume).toBeCloseTo(9000, 6)
    } finally {
      output?.delete()
      source.delete()
    }
  })
  it("adds crush ribs inside an existing bore while leaving its central opening", () => {
    const outer = createOcctCylinder(occt, 6, 10, [0, 0, 0]),
      inner = createOcctCylinder(occt, 4, 10, [0, 0, 0])
    let source: Shape3D | undefined, output: Shape3D | undefined
    try {
      source = cutOcctShapes(occt, outer, inner)
      const before = requireBody(source).volume
      output = createOcctFdmFeature(
        occt,
        {
          ...common,
          kind: "crush-ribs",
          holeDiameter: 8,
          ribHeight: 0.4,
          ribWidth: 0.6,
          depth: 10,
          count: 6,
        },
        source,
      )
      expect(requireBody(output).volume).toBeGreaterThan(before)
      const central = createOcctCylinder(occt, 3.5, 10, [0, 0, 0])
      let checked: Shape3D | undefined
      try {
        checked = cutOcctShapes(occt, output, central)
        expect(requireBody(checked).volume).toBeCloseTo(requireBody(output).volume, 6)
      } finally {
        checked?.delete()
        central.delete()
      }
      expect(requireBody(source).volume).toBeCloseTo(before, 6)
    } finally {
      output?.delete()
      source?.delete()
      inner.delete()
      outer.delete()
    }
  })
  it.each(["X", "Y", "Z"] as const)(
    "creates a connected slotted sleeve along %s with a retained root band",
    (axis) => {
      let output: Shape3D | undefined
      try {
        output = createOcctFdmFeature(occt, {
          ...common,
          axis,
          origin: { x: 10, y: -2, z: 3 },
          kind: "flexible-sleeve",
          outerDiameter: 12,
          innerDiameter: 8,
          length: 10,
          slotWidth: 1,
          slotLength: 7,
          count: 4,
        })
        const volume = requireBody(output).volume
        expect(volume).toBeGreaterThan(Math.PI * (6 ** 2 - 4 ** 2) * 3)
        expect(volume).toBeLessThan(Math.PI * (6 ** 2 - 4 ** 2) * 10)
        const box = output.boundingBox
        try {
          const bounds = box.bounds
          expect(
            bounds[1][axis === "X" ? 0 : axis === "Y" ? 1 : 2] -
              bounds[0][axis === "X" ? 0 : axis === "Y" ? 1 : 2],
          ).toBeCloseTo(10, 5)
        } finally {
          box.delete()
        }
      } finally {
        output?.delete()
      }
    },
  )
  it("fuses an insert boss and drills the authored pocket through that boss", () => {
    const source = createOcctBox(occt, [30, 30, 2], false, [0, 0, -2])
    let output: Shape3D | undefined
    try {
      output = createOcctFdmFeature(
        occt,
        {
          ...common,
          kind: "insert-pocket",
          diameter: 4,
          clearance: 0.2,
          depth: 5,
          bossDiameter: 10,
          bossHeight: 5,
        },
        source,
      )
      expect(requireBody(output).volume).toBeCloseTo(1800 + Math.PI * (5 ** 2 - 2.2 ** 2) * 5, 5)
    } finally {
      output?.delete()
      source.delete()
    }
  })
  it.each(["lip", "groove"] as const)("models an exact rectangular enclosure %s", (mode) => {
    const source =
      mode === "lip"
        ? createOcctBox(occt, [30, 30, 2], false, [0, 0, -2])
        : createOcctBox(occt, [30, 30, 10])
    let output: Shape3D | undefined
    try {
      output = createOcctFdmFeature(
        occt,
        {
          ...common,
          kind: "enclosure-joint",
          width: 20,
          length: 16,
          wall: 1,
          height: 3,
          clearance: 0.2,
          mode,
        },
        source,
      )
      const before = requireBody(source).volume
      const area = mode === "lip" ? 20 * 16 - 18 * 14 : 20.4 * 16.4 - 17.6 * 13.6
      expect(requireBody(output).volume).toBeCloseTo(
        before + (mode === "lip" ? 1 : -1) * area * 3,
        5,
      )
    } finally {
      output?.delete()
      source.delete()
    }
  })
  it.each(["sheet", "bridges"] as const)(
    "adds a sacrificial %s across a cavity and keeps one solid",
    (mode) => {
      const source = cavity()
      let output: Shape3D | undefined
      try {
        const before = requireBody(source).volume
        output = createOcctFdmFeature(
          occt,
          {
            ...common,
            origin: { x: 0, y: 0, z: 5 },
            kind: "membrane",
            width: 24,
            length: 26,
            thickness: 0.2,
            mode,
            ...(mode === "bridges" ? { bridgeCount: 4, bridgeWidth: 1 } : {}),
          },
          source,
        )
        expect(requireBody(output).volume).toBeCloseTo(
          before + (mode === "sheet" ? 24 : 4) * 24 * 0.2,
          5,
        )
      } finally {
        output?.delete()
        source.delete()
      }
    },
  )
  it("builds a stepped-hole coupon with the exact authored diameters", () => {
    let output: Shape3D | undefined
    try {
      output = createOcctFdmFeature(occt, {
        ...common,
        kind: "calibration-coupon",
        diameterStart: 4,
        diameterStep: 0.2,
        holeCount: 5,
        spacing: 8,
        thickness: 3,
        margin: 2,
      })
      const holes = Array.from(
        { length: 5 },
        (_, i) => Math.PI * ((4 + i * 0.2) / 2) ** 2 * 3,
      ).reduce((a, b) => a + b, 0)
      expect(requireBody(output).volume).toBeCloseTo((32 + 4.8 + 4) * (4.8 + 4) * 3 - holes, 5)
    } finally {
      output?.delete()
    }
  })
  it("extends a Web to exact rectangular cavity walls and preserves the target", () => {
    const source = cavity()
    let output: Shape3D | undefined
    try {
      const before = requireBody(source).volume
      output = createOcctFdmFeature(
        occt,
        {
          kind: "web",
          frame: { ...frame, origin: [0, 0, 2] },
          segments: [{ start: [-2, 0], end: [2, 0] }],
          thickness: 1,
          depth: 5,
          direction: "forward",
          style: "web",
          extendToWalls: true,
          supportInputCount: 0,
        },
        source,
      )
      expect(requireBody(output).volume).toBeCloseTo(before + 24 * 5, 4)
      expect(requireBody(source).volume).toBeCloseTo(before, 6)
    } finally {
      output?.delete()
      source.delete()
    }
  })
  it("creates Rib material within the saved sketch plane with normal thickness", () => {
    const source = createOcctBox(occt, [20, 20, 2], false, [0, 0, -2])
    let output: Shape3D | undefined
    try {
      output = createOcctFdmFeature(
        occt,
        {
          kind: "web",
          frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] },
          segments: [{ start: [-5, 0], end: [5, 0] }],
          thickness: 1,
          depth: 6,
          direction: "forward",
          style: "rib",
          extendToWalls: false,
          supportInputCount: 0,
        },
        source,
      )
      expect(requireBody(output).volume).toBeCloseTo(800 + (10 * 6) / 2, 5)
    } finally {
      output?.delete()
      source.delete()
    }
  })
  it("rejects unsupported curved auto-extension, missed cuts, and detached membranes", () => {
    const source = createOcctCylinder(occt, 10, 10, [0, 0, 0])
    try {
      expect(() =>
        createOcctFdmFeature(
          occt,
          {
            kind: "web",
            frame,
            segments: [{ start: [-2, 0], end: [2, 0] }],
            thickness: 1,
            depth: 5,
            direction: "forward",
            style: "web",
            extendToWalls: true,
            supportInputCount: 0,
          },
          source,
        ),
      ).toThrow(/planar prismatic/)
      expect(() =>
        createOcctFdmFeature(
          occt,
          { ...common, origin: { x: 50, y: 0, z: 0 }, kind: "corner-relief", radius: 2, depth: 5 },
          source,
        ),
      ).toThrow(/does not affect material/)
      expect(() =>
        createOcctFdmFeature(
          occt,
          {
            ...common,
            origin: { x: 50, y: 0, z: 0 },
            kind: "membrane",
            width: 10,
            length: 10,
            thickness: 0.2,
            mode: "sheet",
          },
          source,
        ),
      ).toThrow(/connected/)
      expect(requireBody(source).volume).toBeCloseTo(Math.PI * 1000, 5)
    } finally {
      source.delete()
    }
  })
})
