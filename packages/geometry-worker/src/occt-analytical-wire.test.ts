import { setOC } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { describe, expect, it, vi } from "vitest"
import { type AnalyticalProfile, createAnalyticalWire } from "./occt-loft"

const entityId = "018f0000-0000-7000-8000-000000000001" as never
const frame: AnalyticalProfile["frame"] = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
}
const segments: AnalyticalProfile["outer"]["segments"] = [
  {
    type: "line",
    entityId,
    startPointId: entityId,
    endPointId: entityId,
    start: [0, 0],
    end: [1, 0],
  },
  { type: "circle", entityId, center: [0, 0], radius: 1 },
  {
    type: "arc",
    entityId,
    startPointId: entityId,
    endPointId: entityId,
    start: [1, 0],
    middle: [Math.SQRT1_2, Math.SQRT1_2],
    end: [0, 1],
  },
  {
    type: "ellipse",
    entityId,
    center: [0, 0],
    primaryAxisPoint: [2, 0],
    secondaryAxisPoint: [0, 1],
  },
  {
    type: "elliptical-arc",
    entityId,
    startPointId: entityId,
    endPointId: entityId,
    center: [0, 0],
    primaryAxisPoint: [2, 0],
    secondaryAxisPoint: [0, 1],
    start: [2, 0],
    end: [0, 1],
  },
]

function fixture(failureStage = "") {
  const acquired: { name: string; delete: ReturnType<typeof vi.fn> }[] = []
  const rawEdge = { delete: vi.fn() }
  const rawWire = { delete: vi.fn() }
  const binding = (name: string) => {
    if (failureStage === name) throw new Error(`Native ${name} fixture failure`)
    const resource = { name, delete: vi.fn() }
    acquired.push(resource)
    return resource
  }
  const constructors = {
    gp_Pnt_3: vi.fn(function Constructor() {
      return binding("point")
    }),
    gp_Dir_4: vi.fn(function Constructor() {
      return binding("direction")
    }),
    gp_Ax2_2: vi.fn(function Constructor() {
      return binding("axis")
    }),
    gp_Circ_2: vi.fn(function Constructor() {
      return binding("circle")
    }),
    gp_Elips_2: vi.fn(function Constructor() {
      return binding("ellipse")
    }),
    BRepBuilderAPI_MakeEdge_3: vi.fn(function Constructor() {
      return edgeBuilder()
    }),
    BRepBuilderAPI_MakeEdge_8: vi.fn(function Constructor() {
      return edgeBuilder()
    }),
    BRepBuilderAPI_MakeEdge_9: vi.fn(function Constructor() {
      return edgeBuilder()
    }),
    BRepBuilderAPI_MakeEdge_12: vi.fn(function Constructor() {
      return edgeBuilder()
    }),
    BRepBuilderAPI_MakeEdge_13: vi.fn(function Constructor() {
      return edgeBuilder()
    }),
    BRepBuilderAPI_MakeWire_1: vi.fn(function Constructor() {
      return {
        ...binding("wire-builder"),
        Add_1: vi.fn(),
        Build: vi.fn(() => {
          if (failureStage === "wire-build") throw new Error("Native wire-build fixture failure")
        }),
        IsDone: () => true,
        Wire: () => rawWire,
      }
    }),
    Message_ProgressRange_1: vi.fn(function Constructor() {
      return binding("progress")
    }),
  }
  function edgeBuilder() {
    return { ...binding("edge-builder"), IsDone: () => true, Edge: () => rawEdge }
  }
  const occt = constructors as unknown as OpenCascadeInstance
  setOC(occt)
  return { occt, acquired, rawEdge, rawWire }
}

describe("analytical native curve ownership", () => {
  it.each(segments)("releases all point, axis, conic and builder bindings for $type", (segment) => {
    const f = fixture()
    const wire = createAnalyticalWire(f.occt, frame, [segment])
    for (const binding of f.acquired) expect(binding.delete).toHaveBeenCalledOnce()
    expect(f.rawEdge.delete).toHaveBeenCalledOnce()
    expect(f.rawWire.delete).not.toHaveBeenCalled()
    wire.delete()
    expect(f.rawWire.delete).toHaveBeenCalledOnce()
  })
  it.each([
    "direction",
    "axis",
    "circle",
    "edge-builder",
    "wire-builder",
    "progress",
    "wire-build",
  ])("releases acquired analytical bindings after %s failure", (stage) => {
    const f = fixture(stage)
    expect(() =>
      createAnalyticalWire(f.occt, frame, [
        segments[1] as AnalyticalProfile["outer"]["segments"][number],
      ]),
    ).toThrow(`Native ${stage} fixture failure`)
    for (const binding of f.acquired) expect(binding.delete).toHaveBeenCalledOnce()
    expect(f.rawEdge.delete).toHaveBeenCalledTimes(
      ["wire-builder", "progress", "wire-build"].includes(stage) ? 1 : 0,
    )
    expect(f.rawWire.delete).not.toHaveBeenCalled()
  })
})
