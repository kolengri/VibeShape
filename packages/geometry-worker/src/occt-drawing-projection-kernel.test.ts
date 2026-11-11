import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import {
  DRAWING_VIEW_FRAMES,
  type DrawingCurve,
  type DrawingEdge,
  type DrawingViewProjection,
  drawingViewProjectionSchema,
} from "@vibeshape/protocol"
import { makeBox, makeCylinder, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { projectOcctDrawingViews } from "./occt-drawing-projection"

let occt: OpenCascadeInstance
const owned: { delete(): void }[] = []
function keep<T extends { delete(): void }>(value: T) {
  owned.push(value)
  return value
}
beforeAll(async () => {
  const wasmPath = new URL(
    "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
    import.meta.url,
  )
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    { locateFile: () => wasmPath.pathname },
  ])
  setOC(occt)
}, 60_000)
afterEach(() => {
  for (const value of owned.splice(0).reverse()) value.delete()
})

/** A 40 × 30 × 10 mm box with a vertical Ø10 mm through-hole at (20, 15). */
function boxWithHole(): Shape3D {
  const box = makeBox([0, 0, 0], [40, 30, 10])
  const hole = makeCylinder(5, 10, [20, 15, 0], [0, 0, 1])
  try {
    return keep(box.cut(hole))
  } finally {
    box.delete()
    hole.delete()
  }
}

function project(shape: Shape3D, view: DrawingViewProjection["view"]) {
  const [result] = projectOcctDrawingViews(occt, shape.wrapped, [view])
  if (!result) throw new Error(`Missing ${view} view.`)
  return drawingViewProjectionSchema.parse(result)
}

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0
type Line = Extract<DrawingCurve, { kind: "line" }>
/** Order-independent line signature: endpoints rounded and sorted. */
function lineKey({ start, end }: Line) {
  return [start, end]
    .map(([x, y]) => [rounded(x), rounded(y)] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([x, y]) => `${x},${y}`)
    .join(" ")
}
function lines(view: DrawingViewProjection, visibility: DrawingEdge["visibility"]) {
  return view.edges
    .filter((edge) => edge.visibility === visibility)
    .map(({ curve }) => {
      if (curve.kind !== "line") throw new Error(`Expected only lines, got ${curve.kind}.`)
      return lineKey(curve)
    })
    .sort()
}
function rectangle(width: number, height: number) {
  return [
    `0,0 ${width},0`,
    `0,0 0,${height}`,
    `0,${height} ${width},${height}`,
    `${width},0 ${width},${height}`,
  ].sort()
}

describe("exact drawing projection", () => {
  it("shows the hidden through-hole in the front and right views and its rim from above", () => {
    const shape = boxWithHole()
    const front = project(shape, "front")
    expect(lines(front, "visible")).toEqual(rectangle(40, 10))
    expect(lines(front, "hidden")).toEqual(["15,0 15,10", "25,0 25,10"])
    expect(front.bounds).toEqual({ min: [0, 0], max: [40, 10] })

    const right = project(shape, "right")
    expect(lines(right, "visible")).toEqual(rectangle(30, 10))
    expect(lines(right, "hidden")).toEqual(["10,0 10,10", "20,0 20,10"])

    const top = project(shape, "top")
    expect(top.edges.filter(({ visibility }) => visibility === "hidden")).toEqual([])
    const circles = top.edges.flatMap(({ curve }) => (curve.kind === "circle" ? [curve] : []))
    expect(circles).toHaveLength(1)
    expect(circles[0]?.center[0]).toBeCloseTo(20, 9)
    expect(circles[0]?.center[1]).toBeCloseTo(15, 9)
    expect(circles[0]?.radius).toBeCloseTo(5, 9)
    expect(
      top.edges
        .filter(({ curve }) => curve.kind === "line")
        .map(({ curve }) => lineKey(curve as Line))
        .sort(),
    ).toEqual(rectangle(40, 30))
  })

  it("draws cylinder silhouettes as visible outlines in side views and a circle from above", () => {
    const cylinder = keep(makeCylinder(8, 20, [0, 0, 0], [0, 0, 1]))
    for (const view of ["front", "back", "right", "left"] as const) {
      const side = project(cylinder, view)
      // Where the seam lies on the silhouette, HLR reports that side as the sharp seam edge.
      const silhouettes = side.edges
        .filter(
          (edge) =>
            edge.visibility === "visible" &&
            edge.curve.kind === "line" &&
            Math.abs(edge.curve.start[0] - edge.curve.end[0]) < 1e-9,
        )
        .map(({ curve }) => lineKey(curve as Line))
        .sort()
      expect(silhouettes).toEqual(["-8,0 -8,20", "8,0 8,20"])
      expect(side.edges.some(({ edgeClass }) => edgeClass === "outline")).toBe(true)
      expect(side.edges.filter(({ visibility }) => visibility === "hidden")).toEqual([])
      expect(side.bounds.min[0]).toBeCloseTo(-8, 9)
      expect(side.bounds.max[0]).toBeCloseTo(8, 9)
    }
    const top = project(cylinder, "top")
    expect(top.edges).toEqual([
      {
        visibility: "visible",
        edgeClass: "sharp",
        curve: expect.objectContaining({ kind: "circle" }),
      },
    ])
  })

  it("matches every view extent to the body bounds projected onto that view", () => {
    const shape = boxWithHole()
    const corners = [0, 40].flatMap((x) => [0, 30].flatMap((y) => [0, 10].map((z) => [x, y, z])))
    for (const view of ["front", "back", "top", "bottom", "right", "left", "isometric"] as const) {
      const { normal, xAxis } = DRAWING_VIEW_FRAMES[view]
      const yAxis = [
        normal[1] * xAxis[2] - normal[2] * xAxis[1],
        normal[2] * xAxis[0] - normal[0] * xAxis[2],
        normal[0] * xAxis[1] - normal[1] * xAxis[0],
      ]
      const dot = (axis: readonly number[], point: readonly number[]) =>
        axis.reduce((sum, value, index) => sum + value * (point[index] ?? 0), 0)
      const xs = corners.map((corner) => dot(xAxis, corner))
      const ys = corners.map((corner) => dot(yAxis, corner))
      const { bounds } = project(shape, view)
      expect(bounds.min[0]).toBeCloseTo(Math.min(...xs), 6)
      expect(bounds.max[0]).toBeCloseTo(Math.max(...xs), 6)
      expect(bounds.min[1]).toBeCloseTo(Math.min(...ys), 6)
      expect(bounds.max[1]).toBeCloseTo(Math.max(...ys), 6)
    }
  })

  it("keeps the hidden slot floor behind a rib where visible step edges stop", () => {
    // 100 x 30 x 30 block with a front step down to z = 20, a rib at x 55-70 filling the step,
    // and a slot cut through from the back at z 20-25.
    const parts = [
      makeBox([0, 0, 0], [100, 30, 20]),
      makeBox([0, 10, 20], [100, 30, 30]),
      makeBox([55, 0, 20], [70, 10, 30]),
      makeBox([-1, 15, 20], [101, 31, 25]),
    ]
    const [base, back, rib, slot] = parts
    if (!base || !back || !rib || !slot) throw new Error("Missing probe parts.")
    const stepped = base.fuse(back)
    const ribbed = stepped.fuse(rib)
    const probe = keep(ribbed.cut(slot))
    for (const part of [...parts, stepped, ribbed]) part.delete()
    const front = project(probe, "front")
    const atFloor = (visibility: DrawingEdge["visibility"]) =>
      front.edges
        .filter(
          (edge) =>
            edge.visibility === visibility &&
            edge.curve.kind === "line" &&
            Math.abs(edge.curve.start[1] - 20) < 1e-6 &&
            Math.abs(edge.curve.end[1] - 20) < 1e-6,
        )
        .map(({ curve }) => lineKey(curve as Line))
        .sort()
    expect(atFloor("visible")).toEqual(["0,20 55,20", "70,20 100,20"])
    expect(atFloor("hidden")).toEqual(["55,20 70,20"])
  })

  it("keeps arcs exact and counter-clockwise", () => {
    const quarter = keep(makeCylinder(10, 5, [0, 0, 0], [0, 0, 1]))
    const cutter = keep(makeBox([-20, -20, -1], [0, 20, 6]))
    const half = keep(quarter.cut(cutter))
    const top = project(half, "top")
    const arcs = top.edges.flatMap(({ curve }) => (curve.kind === "arc" ? [curve] : []))
    expect(arcs).toHaveLength(1)
    expect(arcs[0]?.radius).toBeCloseTo(10, 9)
    expect(arcs[0]?.startAngle).toBeCloseTo(-Math.PI / 2, 9)
    expect(arcs[0]?.endAngle).toBeCloseTo(Math.PI / 2, 9)
  })

  it("produces identical projections for identical input", () => {
    const shape = boxWithHole()
    const views = ["front", "isometric"] as const
    const projected = projectOcctDrawingViews(occt, shape.wrapped, views)
    expect(projected).toEqual(projectOcctDrawingViews(occt, shape.wrapped, views))
    // Pictorial views skip hidden-line extraction entirely.
    expect(projected[1]?.edges.length).toBeGreaterThan(0)
    expect(projected[1]?.edges.every(({ visibility }) => visibility === "visible")).toBe(true)
  })
})

type Deletable = { delete(): void }
/**
 * Tracks native wrappers acquired through the kernel: objects built with `new` and wrappers
 * returned by instance or static methods. `failOn` injects a constructor failure.
 */
function trackedKernel(failOn?: string) {
  const created: { deleted: number; name: string }[] = []
  const targets = new WeakMap<object, object>()
  const unwrap = (value: unknown) =>
    (typeof value === "object" && value !== null && targets.get(value)) || value
  const isWrapper = (value: unknown): value is Deletable =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<Deletable>).delete === "function"
  const track = (value: unknown, name: string): unknown => {
    if (!isWrapper(value) || targets.has(value)) return value
    const record = { deleted: 0, name }
    created.push(record)
    const release = value.delete.bind(value)
    value.delete = () => {
      record.deleted += 1
      release()
    }
    const proxy = new Proxy(value, {
      get(target, key) {
        const member = Reflect.get(target, key)
        if (typeof member !== "function" || key === "delete") return member
        return (...args: unknown[]) => {
          const result = Reflect.apply(member, target, args.map(unwrap))
          return key === "get" ? result : track(result, `${name}.${String(key)}`)
        }
      },
    })
    targets.set(proxy, value)
    return proxy
  }
  const kernel = new Proxy(occt, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== "function" || typeof key !== "string" || !/^[A-Z]/.test(key))
        return value
      return new Proxy(value, {
        construct(native, args): object {
          if (key === failOn) throw new Error(`Injected ${key} failure.`)
          return track(Reflect.construct(native, args.map(unwrap)), key) as object
        },
        get(owner, member) {
          const value = Reflect.get(owner, member)
          if (typeof value !== "function" || member === "prototype") return value
          return (...args: unknown[]) =>
            track(Reflect.apply(value, owner, args.map(unwrap)), `${key}.${String(member)}`)
        },
      })
    },
  })
  return { kernel, created }
}

/** The raw HLR algorithm is owned by its intrusive handle, which releases it. */
function expectAllReleased(created: readonly { deleted: number; name: string }[]) {
  expect(created.filter(({ deleted, name }) => name !== "HLRBRep_Algo_1" && deleted !== 1)).toEqual(
    [],
  )
}

describe("drawing projection native disposal", () => {
  it("releases every acquired wrapper on success and on failure", () => {
    const shape = boxWithHole()
    const success = trackedKernel()
    const [view] = projectOcctDrawingViews(success.kernel, shape.wrapped, ["front"])
    expect(view?.edges.length).toBeGreaterThan(0)
    const names = success.created.map(({ name }) => name)
    for (const name of [
      "HLRBRep_HLRToShape",
      "BRepAdaptor_Curve_2",
      "TopoDS.Edge_1",
      "VCompound_1",
    ])
      expect(names.some((item) => item.endsWith(name))).toBe(true)
    expectAllReleased(success.created)

    const failure = trackedKernel("HLRBRep_HLRToShape")
    expect(() => projectOcctDrawingViews(failure.kernel, shape.wrapped, ["top"])).toThrow(
      "Injected HLRBRep_HLRToShape failure.",
    )
    expect(failure.created.some(({ name }) => name === "Handle_HLRBRep_Algo_2")).toBe(true)
    expectAllReleased(failure.created)

    const late = trackedKernel("GCPnts_TangentialDeflection_2")
    expect(() => projectOcctDrawingViews(late.kernel, shape.wrapped, ["isometric"])).toThrow(
      "Injected GCPnts_TangentialDeflection_2 failure.",
    )
    expectAllReleased(late.created)
  })
})
