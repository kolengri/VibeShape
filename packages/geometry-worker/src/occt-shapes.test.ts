import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
  } as unknown as OpenCascadeInstance
  const operations = createOcctShapeOperations(vi.fn(() => wrappedShape) as never)

  return {
    axis,
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

    expect(result).toBe(fixture.wrappedShape)
    expect(fixture.opencascade.gp_Pnt_3).toHaveBeenCalledWith(-22, -24, -4)
    expect(fixture.maker.delete).toHaveBeenCalledOnce()
    expect(fixture.point.delete).toHaveBeenCalledOnce()
    expect(fixture.rawShape.delete).toHaveBeenCalledOnce()
  })

  it("positions a cylinder on a positive-Z axis and deletes every temporary binding", () => {
    const fixture = createPrimitiveFixture()

    const result = fixture.operations.createCylinder(fixture.opencascade, 8, 30, [0, 0, -5])

    expect(result).toBe(fixture.wrappedShape)
    expect(fixture.opencascade.gp_Pnt_3).toHaveBeenCalledWith(0, 0, -5)
    expect(fixture.opencascade.gp_Dir_4).toHaveBeenCalledWith(0, 0, 1)
    expect(fixture.axis.delete).toHaveBeenCalledOnce()
    expect(fixture.direction.delete).toHaveBeenCalledOnce()
    expect(fixture.point.delete).toHaveBeenCalledOnce()
    expect(fixture.maker.delete).toHaveBeenCalledOnce()
    expect(fixture.rawShape.delete).toHaveBeenCalledOnce()
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

    expect(result).toBe(wrappedShape)
    expect(cutter.Build).toHaveBeenCalledWith(progress)
    expect(cutter.SetToFillHistory).toHaveBeenCalledWith(false)
    expect(cutter.SimplifyResult).toHaveBeenCalledWith(true, true, 1e-3)
    expect(rawShape.delete).toHaveBeenCalledOnce()
    expect(cutter.delete).toHaveBeenCalledOnce()
    expect(progress.delete).toHaveBeenCalledOnce()
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

    expect(result).toBe(wrappedShape)
    expect(builderConstructor).toHaveBeenCalledWith(source.wrapped, tool.wrapped, progress)
    expect(builder.Build).toHaveBeenCalledWith(progress)
    expect(builder.SetToFillHistory).toHaveBeenCalledWith(false)
    expect(builder.SimplifyResult).toHaveBeenCalledWith(true, true, 1e-3)
    expect(rawShape.delete).toHaveBeenCalledOnce()
    expect(builder.delete).toHaveBeenCalledOnce()
    expect(progress.delete).toHaveBeenCalledOnce()
  })
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

    expect(result).toBe(wrappedShape)
    expect(builder.Add_2).toHaveBeenCalledWith(1.5, edge)
    expect(builder.Build).toHaveBeenCalledWith(progress)
    expect(rawShape.delete).toHaveBeenCalledOnce()
    expect(rawEdge.delete).toHaveBeenCalledOnce()
    expect(edge.delete).toHaveBeenCalledOnce()
    expect(sourceEdge.delete).toHaveBeenCalledOnce()
    expect(rawVertex.delete).toHaveBeenCalledOnce()
    expect(vertex.delete).toHaveBeenCalledOnce()
    expect(point.delete).toHaveBeenCalledOnce()
    expect(edgeExplorer.delete).toHaveBeenCalledOnce()
    expect(vertexExplorer.delete).toHaveBeenCalledOnce()
    expect(builder.delete).toHaveBeenCalledOnce()
    expect(progress.delete).toHaveBeenCalledOnce()
  })
})
