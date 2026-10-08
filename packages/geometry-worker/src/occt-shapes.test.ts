import { beforeEach, describe, expect, it } from "bun:test"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { createOcctShapeOperations } from "./occt-shapes"

function createDeletable() {
  return { delete: vi.fn() }
}

function createConstructor<T>(value: T) {
  return vi.fn(function MockConstructor() {
    return value
  })
}

function createPrimitiveFixture() {
  const rawShape = createDeletable()
  const wrappedShape = { wrapped: createDeletable() }
  const maker = { ...createDeletable(), Solid: vi.fn(() => rawShape) }
  const point = createDeletable()
  const direction = createDeletable()
  const axis = createDeletable()
  const opencascade = {
    gp_Pnt_3: createConstructor(point),
    gp_Dir_4: createConstructor(direction),
    gp_Ax2_3: createConstructor(axis),
    BRepPrimAPI_MakeBox_3: createConstructor(maker),
    BRepPrimAPI_MakeCylinder_3: createConstructor(maker),
    BRepPrimAPI_MakeSphere_5: createConstructor(maker),
    BRepPrimAPI_MakeTorus_5: createConstructor(maker),
  } as unknown as OpenCascadeInstance
  const castShape = vi.fn(() => wrappedShape)
  const operations = createOcctShapeOperations(castShape as never)

  return {
    axis,
    castShape,
    direction,
    maker,
    opencascade,
    operations,
    point,
    rawShape,
    wrappedShape,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("owned OCCT primitive adapters", () => {
  it("centers a box around its placement axis and deletes every temporary binding", () => {
    const fixture = createPrimitiveFixture()

    const result = fixture.operations.createBox(fixture.opencascade, [60, 40, 20], true, [8, -4, 6])

    expect(result).toBe<unknown>(fixture.wrappedShape)
    expect(fixture.opencascade.gp_Pnt_3).toHaveBeenCalledWith(-22, -24, -4)
    expect(fixture.maker.delete).toHaveBeenCalledTimes(1)
    expect(fixture.point.delete).toHaveBeenCalledTimes(1)
    expect(fixture.rawShape.delete).toHaveBeenCalledTimes(1)
  })

  it("positions a cylinder on a positive-Z axis and deletes every temporary binding", () => {
    const fixture = createPrimitiveFixture()

    const result = fixture.operations.createCylinder(fixture.opencascade, 8, 30, [0, 0, -5])

    expect(result).toBe<unknown>(fixture.wrappedShape)
    expect(fixture.opencascade.gp_Pnt_3).toHaveBeenCalledWith(0, 0, -5)
    expect(fixture.opencascade.gp_Dir_4).toHaveBeenCalledWith(0, 0, 1)
    expect(fixture.axis.delete).toHaveBeenCalledTimes(1)
    expect(fixture.direction.delete).toHaveBeenCalledTimes(1)
    expect(fixture.point.delete).toHaveBeenCalledTimes(1)
    expect(fixture.maker.delete).toHaveBeenCalledTimes(1)
    expect(fixture.rawShape.delete).toHaveBeenCalledTimes(1)
  })
})

describe("owned radial primitive adapters", () => {
  it("constructs and disposes a placed sphere", () => {
    const fixture = createPrimitiveFixture()
    expect(fixture.operations.createSphere(fixture.opencascade, 4, [8, -4, 6])).toBe<unknown>(
      fixture.wrappedShape,
    )
    expect(fixture.opencascade.BRepPrimAPI_MakeSphere_5).toHaveBeenCalledWith(fixture.point, 4)
    expect(fixture.point.delete).toHaveBeenCalledTimes(1)
    expect(fixture.maker.delete).toHaveBeenCalledTimes(1)
    expect(fixture.rawShape.delete).toHaveBeenCalledTimes(1)
  })
  it("constructs a placed torus around a positive Z axis", () => {
    const fixture = createPrimitiveFixture()
    expect(fixture.operations.createTorus(fixture.opencascade, 12, 4, [8, -4, 6])).toBe<unknown>(
      fixture.wrappedShape,
    )
    expect(fixture.opencascade.gp_Dir_4).toHaveBeenCalledWith(0, 0, 1)
    expect(fixture.opencascade.BRepPrimAPI_MakeTorus_5).toHaveBeenCalledWith(fixture.axis, 12, 4)
    for (const object of [
      fixture.axis,
      fixture.direction,
      fixture.point,
      fixture.maker,
      fixture.rawShape,
    ])
      expect(object.delete).toHaveBeenCalledTimes(1)
  })
  it.each(["sphere", "torus"] as const)(
    "disposes %s bindings when shape adoption fails",
    (kind) => {
      const fixture = createPrimitiveFixture()
      fixture.castShape.mockImplementationOnce(() => {
        throw new Error("Fixture adoption failed")
      })
      const call = () =>
        kind === "sphere"
          ? fixture.operations.createSphere(fixture.opencascade, 4, [0, 0, 0])
          : fixture.operations.createTorus(fixture.opencascade, 12, 4, [0, 0, 0])
      expect(call).toThrow("Fixture adoption failed")
      for (const object of [fixture.point, fixture.maker, fixture.rawShape])
        expect(object.delete).toHaveBeenCalledTimes(1)
      if (kind === "torus") {
        expect(fixture.axis.delete).toHaveBeenCalledTimes(1)
        expect(fixture.direction.delete).toHaveBeenCalledTimes(1)
      }
    },
  )
  it("releases earlier torus bindings if the axis constructor fails", () => {
    const fixture = createPrimitiveFixture()
    vi.mocked(fixture.opencascade.gp_Ax2_3).mockImplementationOnce(function Constructor() {
      throw new Error("Fixture axis failed")
    })
    expect(() => fixture.operations.createTorus(fixture.opencascade, 12, 4, [0, 0, 0])).toThrow(
      "Fixture axis failed",
    )
    expect(fixture.point.delete).toHaveBeenCalledTimes(1)
    expect(fixture.direction.delete).toHaveBeenCalledTimes(1)
  })
})

function createOwnedPrimitiveFixture() {
  const allocated: ReturnType<typeof createDeletable>[] = []
  const binding = () => {
    const value = createDeletable()
    allocated.push(value)
    return value
  }
  const bindingConstructor = <T>(create: (...args: unknown[]) => T) =>
    vi.fn(function MockConstructor(...args: unknown[]) {
      return create(...args)
    })
  const opencascade = {
    gp_Pnt_3: bindingConstructor(binding),
    gp_Dir_4: bindingConstructor(binding),
    gp_Ax1_2: bindingConstructor(binding),
    BRepBuilderAPI_MakeEdge_3: bindingConstructor(() => ({ ...binding(), Edge: vi.fn(binding) })),
    BRepBuilderAPI_MakeWire_4: bindingConstructor(() => ({ ...binding(), Wire: vi.fn(binding) })),
    BRepBuilderAPI_MakeFace_15: bindingConstructor(() => ({
      ...binding(),
      IsDone: () => true,
      Face: vi.fn(binding),
    })),
    BRepPrimAPI_MakeRevol_1: bindingConstructor(() => ({ ...binding(), Shape: vi.fn(binding) })),
    BRepBuilderAPI_MakeWire_1: bindingConstructor(() => ({
      ...binding(),
      IsDone: () => true,
      Add_1: vi.fn(),
      Wire: vi.fn(binding),
    })),
    BRepBuilderAPI_MakeVertex: bindingConstructor(() => ({ ...binding(), Vertex: vi.fn(binding) })),
    BRepOffsetAPI_ThruSections: bindingConstructor(() => ({
      ...binding(),
      IsDone: () => true,
      CheckCompatibility: vi.fn(),
      AddWire: vi.fn(),
      AddVertex: vi.fn(),
      Build: vi.fn(),
      Shape: vi.fn(binding),
    })),
    Message_ProgressRange_1: bindingConstructor(binding),
  }
  const castShape = vi.fn(() => ({ wrapped: createDeletable() }))
  return {
    allocated,
    opencascade,
    castShape,
    operations: createOcctShapeOperations(castShape as never),
  }
}

describe("owned exact cone meridian", () => {
  it("revolves an exact closed meridian and releases every binding", () => {
    const fixture = createOwnedPrimitiveFixture()
    fixture.operations.createCone(
      fixture.opencascade as unknown as OpenCascadeInstance,
      4,
      12,
      [8, -4, 6],
    )
    expect(fixture.opencascade.gp_Pnt_3.mock.calls).toEqual([
      [8, -4, 6],
      [12, -4, 6],
      [8, -4, 18],
    ])
    expect(fixture.opencascade.BRepPrimAPI_MakeRevol_1).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      2 * Math.PI,
      false,
    )
    expect(fixture.castShape).toHaveBeenCalledTimes(1)
    for (const object of fixture.allocated) expect(object.delete).toHaveBeenCalledTimes(1)
  })
  it.each([
    "gp_Pnt_3",
    "BRepBuilderAPI_MakeEdge_3",
    "BRepBuilderAPI_MakeWire_4",
    "BRepBuilderAPI_MakeFace_15",
    "BRepPrimAPI_MakeRevol_1",
  ] as const)("releases all previously allocated bindings when %s fails", (stage) => {
    const fixture = createOwnedPrimitiveFixture()
    fixture.opencascade[stage].mockImplementationOnce(function Constructor(): never {
      throw new Error("Fixture construction failed")
    })
    expect(() =>
      fixture.operations.createCone(
        fixture.opencascade as unknown as OpenCascadeInstance,
        4,
        12,
        [0, 0, 0],
      ),
    ).toThrow("Fixture construction failed")
    expect(fixture.castShape).not.toHaveBeenCalled()
    for (const object of fixture.allocated) expect(object.delete).toHaveBeenCalledTimes(1)
  })
  it("releases the meridian and output when shape adoption fails", () => {
    const fixture = createOwnedPrimitiveFixture()
    fixture.castShape.mockImplementationOnce(() => {
      throw new Error("Fixture adoption failed")
    })
    expect(() =>
      fixture.operations.createCone(
        fixture.opencascade as unknown as OpenCascadeInstance,
        4,
        12,
        [0, 0, 0],
      ),
    ).toThrow("Fixture adoption failed")
    for (const object of fixture.allocated) expect(object.delete).toHaveBeenCalledTimes(1)
  })
})

describe("owned exact pyramid solid", () => {
  it("lofts a closed polygon to the apex and releases every native handle", () => {
    const fixture = createOwnedPrimitiveFixture()
    fixture.operations.createPyramid(
      fixture.opencascade as unknown as OpenCascadeInstance,
      4,
      12,
      35,
      [8, -4, 6],
    )
    expect(fixture.opencascade.gp_Pnt_3.mock.calls[0]).toEqual([20, -4, 6])
    expect(fixture.opencascade.gp_Pnt_3.mock.calls[4]).toEqual([8, -4, 41])
    expect(fixture.opencascade.BRepBuilderAPI_MakeEdge_3).toHaveBeenCalledTimes(4)
    expect(fixture.opencascade.BRepOffsetAPI_ThruSections).toHaveBeenCalledWith(true, true, 1e-7)
    expect(fixture.castShape).toHaveBeenCalledTimes(1)
    for (const object of fixture.allocated) expect(object.delete).toHaveBeenCalledTimes(1)
  })
  it.each([
    "gp_Pnt_3",
    "BRepBuilderAPI_MakeWire_1",
    "BRepBuilderAPI_MakeEdge_3",
    "BRepBuilderAPI_MakeVertex",
    "BRepOffsetAPI_ThruSections",
    "Message_ProgressRange_1",
  ] as const)("releases earlier pyramid bindings when %s fails", (stage) => {
    const fixture = createOwnedPrimitiveFixture()
    fixture.opencascade[stage].mockImplementationOnce(function Constructor(): never {
      throw new Error("Fixture construction failed")
    })
    expect(() =>
      fixture.operations.createPyramid(
        fixture.opencascade as unknown as OpenCascadeInstance,
        6,
        12,
        35,
        [0, 0, 0],
      ),
    ).toThrow("Fixture construction failed")
    expect(fixture.castShape).not.toHaveBeenCalled()
    for (const object of fixture.allocated) expect(object.delete).toHaveBeenCalledTimes(1)
  })
  it("releases the polygon, loft, and output when adoption fails", () => {
    const fixture = createOwnedPrimitiveFixture()
    fixture.castShape.mockImplementationOnce(() => {
      throw new Error("Fixture adoption failed")
    })
    expect(() =>
      fixture.operations.createPyramid(
        fixture.opencascade as unknown as OpenCascadeInstance,
        6,
        12,
        35,
        [0, 0, 0],
      ),
    ).toThrow("Fixture adoption failed")
    for (const object of fixture.allocated) expect(object.delete).toHaveBeenCalledTimes(1)
  })
})

describe("owned OCCT boolean adapter", () => {
  it("deletes the boolean builder, progress range, and intermediate shape", () => {
    const rawShape = createDeletable()
    const wrappedShape = { wrapped: createDeletable() }
    const progress = createDeletable()
    const cutter = {
      ...createDeletable(),
      Build: vi.fn(),
      SetToFillHistory: vi.fn(),
      Shape: vi.fn(() => rawShape),
      SimplifyResult: vi.fn(),
    }
    const opencascade = {
      Message_ProgressRange_1: createConstructor(progress),
      BRepAlgoAPI_Cut_3: createConstructor(cutter),
    } as unknown as OpenCascadeInstance
    const source = { wrapped: createDeletable() }
    const tool = { wrapped: createDeletable() }
    const operations = createOcctShapeOperations(vi.fn(() => wrappedShape) as never)

    const result = operations.cutShapes(opencascade, source as never, tool as never)

    expect(result).toBe<unknown>(wrappedShape)
    expect(cutter.Build).toHaveBeenCalledWith(progress)
    expect(cutter.SetToFillHistory).toHaveBeenCalledWith(false)
    expect(cutter.SimplifyResult).toHaveBeenCalledWith(true, true, 1e-3)
    expect(rawShape.delete).toHaveBeenCalledTimes(1)
    expect(cutter.delete).toHaveBeenCalledTimes(1)
    expect(progress.delete).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["fuseShapes", "BRepAlgoAPI_Fuse_3"],
    ["intersectShapes", "BRepAlgoAPI_Common_3"],
  ] as const)("owns the %s builder and result", (operation, constructorName) => {
    const rawShape = createDeletable()
    const wrappedShape = { wrapped: createDeletable() }
    const progress = createDeletable()
    const builder = {
      ...createDeletable(),
      Build: vi.fn(),
      SetToFillHistory: vi.fn(),
      Shape: vi.fn(() => rawShape),
      SimplifyResult: vi.fn(),
    }
    const builderConstructor = createConstructor(builder)
    const opencascade = {
      Message_ProgressRange_1: createConstructor(progress),
      [constructorName]: builderConstructor,
    } as unknown as OpenCascadeInstance
    const source = { wrapped: createDeletable() }
    const tool = { wrapped: createDeletable() }
    const operations = createOcctShapeOperations(vi.fn(() => wrappedShape) as never)

    const result = operations[operation](opencascade, source as never, tool as never)

    expect(result).toBe<unknown>(wrappedShape)
    expect(builderConstructor).toHaveBeenCalledWith(source.wrapped, tool.wrapped, progress)
    expect(builder.Build).toHaveBeenCalledWith(progress)
    expect(builder.SetToFillHistory).toHaveBeenCalledWith(false)
    expect(builder.SimplifyResult).toHaveBeenCalledWith(true, true, 1e-3)
    expect(rawShape.delete).toHaveBeenCalledTimes(1)
    expect(builder.delete).toHaveBeenCalledTimes(1)
    expect(progress.delete).toHaveBeenCalledTimes(1)
  })
})

describe("owned Boolean constructor failure", () => {
  it.each(["fuseShapes", "intersectShapes"] as const)(
    "releases progress when %s builder construction fails",
    (operation) => {
      const progress = createDeletable()
      const fail = vi.fn(function Constructor() {
        throw new Error("Boolean builder fixture failure")
      })
      const opencascade = {
        Message_ProgressRange_1: createConstructor(progress),
        BRepAlgoAPI_Fuse_3: fail,
        BRepAlgoAPI_Common_3: fail,
      } as unknown as OpenCascadeInstance
      const operations = createOcctShapeOperations(vi.fn() as never)
      const source = { wrapped: {} }
      expect(() => operations[operation](opencascade, source as never, source as never)).toThrow()
      expect(progress.delete).toHaveBeenCalledTimes(1)
    },
  )
})

describe("owned OCCT fillet adapter", () => {
  it("selects target-plane edges and deletes explorer temporaries", () => {
    const edgeType = {}
    const vertexType = {}
    const shapeType = {}
    const rawShape = createDeletable()
    const wrappedShape = { wrapped: createDeletable() }
    const rawEdge = createDeletable()
    const edge = { ...createDeletable(), HashCode: vi.fn(() => 91) }
    const sourceEdge = { ...createDeletable(), geomType: "LINE", hashCode: 91 }
    const rawVertex = createDeletable()
    const vertex = createDeletable()
    const point = { ...createDeletable(), Z: vi.fn(() => 20) }
    const progress = createDeletable()
    const edgeExplorer = {
      ...createDeletable(),
      Current: vi.fn(() => rawEdge),
      More: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
      Next: vi.fn(),
    }
    const vertexExplorer = {
      ...createDeletable(),
      Current: vi.fn(() => rawVertex),
      More: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
      Next: vi.fn(),
    }
    const builder = {
      ...createDeletable(),
      Add_2: vi.fn(),
      Build: vi.fn(),
      Shape: vi.fn(() => rawShape),
    }
    const opencascade = {
      BRepFilletAPI_MakeFillet: createConstructor(builder),
      BRep_Tool: { Pnt: vi.fn(() => point) },
      ChFi3d_FilletShape: { ChFi3d_Rational: {} },
      Message_ProgressRange_1: createConstructor(progress),
      TopAbs_ShapeEnum: {
        TopAbs_EDGE: edgeType,
        TopAbs_SHAPE: shapeType,
        TopAbs_VERTEX: vertexType,
      },
      TopExp_Explorer_2: vi.fn(function MockExplorer(_shape, type) {
        return type === edgeType ? edgeExplorer : vertexExplorer
      }),
      TopoDS: {
        Edge_1: vi.fn(() => edge),
        Vertex_1: vi.fn(() => vertex),
      },
    } as unknown as OpenCascadeInstance
    const operations = createOcctShapeOperations(vi.fn(() => wrappedShape) as never)

    const result = operations.filletEdgesAtZ(
      opencascade,
      { edges: [sourceEdge], wrapped: createDeletable() } as never,
      1.5,
      20,
    )

    expect(result).toBe<unknown>(wrappedShape)
    expect(builder.Add_2).toHaveBeenCalledWith(1.5, edge)
    expect(builder.Build).toHaveBeenCalledWith(progress)
    expect(rawShape.delete).toHaveBeenCalledTimes(1)
    expect(rawEdge.delete).toHaveBeenCalledTimes(1)
    expect(edge.delete).toHaveBeenCalledTimes(1)
    expect(sourceEdge.delete).toHaveBeenCalledTimes(1)
    expect(rawVertex.delete).toHaveBeenCalledTimes(1)
    expect(vertex.delete).toHaveBeenCalledTimes(1)
    expect(point.delete).toHaveBeenCalledTimes(1)
    expect(edgeExplorer.delete).toHaveBeenCalledTimes(1)
    expect(vertexExplorer.delete).toHaveBeenCalledTimes(1)
    expect(builder.delete).toHaveBeenCalledTimes(1)
    expect(progress.delete).toHaveBeenCalledTimes(1)
  })
})
