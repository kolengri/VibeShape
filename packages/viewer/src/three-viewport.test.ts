import { describe, expect, it, vi } from "vitest"
import { viewerSketchReferenceCandidateKey } from "./sketch-reference-identity"
import {
  createFaceHighlightGeometry,
  createLatestFramePublisher,
  createViewerGeometry,
  createViewerSketchGeometry,
  createViewerSketchProfileGeometry,
  isValidViewerFrame,
  orderedEligibleViewerSelections,
  orderedUniqueViewerSelections,
  orderedUniqueViewerSketchProfiles,
  orthographicFrustum,
  type ViewerMesh,
  viewerAngularGizmoAngle,
  viewerAngularGizmoPoint,
  viewerAxialGizmoDistance,
  viewerAxialGizmoHandlePosition,
  viewerCameraPoseForFrame,
  viewerCameraPoseForStandardView,
  viewerFaceOrdinal,
  viewerSketchProfileKey,
  viewerSketchProjectionTarget,
  viewerSketchProjectionViewHeight,
} from "./three-viewport"
import { viewerBodyColor } from "./viewer-appearance"

const mesh: ViewerMesh = {
  featureId: "box",
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([7]),
}

describe("Three viewport geometry", () => {
  const profileSelector = (sketchId: string, boundary: string) => ({
    schemaVersion: 0 as const,
    sketchId,
    outerBoundaryEntityIds: [boundary],
    holeBoundaryEntityIds: [],
  })

  it("publishes only the latest translation sample per frame and flushes release synchronously", () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    const publish = vi.fn()
    let nextHandle = 0
    const publisher = createLatestFramePublisher(
      publish,
      (callback) => {
        nextHandle += 1
        callbacks.set(nextHandle, callback)
        return nextHandle
      },
      (handle) => callbacks.delete(handle),
    )

    publisher.push([1, 0, 0])
    publisher.push([2, 0, 0])
    publisher.push([3, 0, 0])
    expect(callbacks.size).toBe(1)
    expect(publish).not.toHaveBeenCalled()

    publisher.flush()
    expect(callbacks.size).toBe(0)
    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenLastCalledWith([3, 0, 0])
  })

  it("maps a normalized axial distance to and from its world-space handle", () => {
    const gizmo = {
      direction: [0, 3, 4] as const,
      distance: 10,
      origin: [2, 5, 7] as const,
    }
    const position = viewerAxialGizmoHandlePosition(gizmo)

    expect(position).toEqual([2, 11, 15])
    expect(position && viewerAxialGizmoDistance(gizmo, position)).toBeCloseTo(10)
    expect(viewerAxialGizmoDistance(gizmo, [2, 8, 11])).toBeCloseTo(5)
  })

  it("fails closed for invalid axial manipulator frames", () => {
    expect(
      viewerAxialGizmoHandlePosition({ direction: [0, 0, 0], distance: 10, origin: [0, 0, 0] }),
    ).toBeNull()
    expect(
      viewerAxialGizmoDistance({ direction: [0, 0, 0], origin: [0, 0, 0] }, [0, 0, 1]),
    ).toBeNull()
  })

  it("maps angular manipulator values to exact points around an arbitrary world axis", () => {
    const gizmo = {
      angle: Math.PI / 2,
      axisDirection: [0, 2, 0] as const,
      axisOrigin: [1, 2, 3] as const,
      rotationOrigin: [4, 2, 3] as const,
    }

    const point = viewerAngularGizmoPoint(gizmo)

    expect(point?.[0]).toBeCloseTo(1)
    expect(point?.[1]).toBeCloseTo(2)
    expect(point?.[2]).toBeCloseTo(0)
    expect(point && viewerAngularGizmoAngle(gizmo, point)).toBeCloseTo(Math.PI / 2)
  })

  it("unwraps angular manipulator input continuously near a full revolution", () => {
    const gizmo = {
      angle: Math.PI * 2 - 0.05,
      axisDirection: [0, 0, 1] as const,
      axisOrigin: [0, 0, 0] as const,
      rotationOrigin: [10, 0, 0] as const,
    }
    const point = viewerAngularGizmoPoint(gizmo)

    expect(point && viewerAngularGizmoAngle(gizmo, point, Math.PI * 2)).toBeCloseTo(
      Math.PI * 2 - 0.05,
    )
    expect(viewerAngularGizmoAngle(gizmo, [10, -0.01, 0], Math.PI * 2)).toBeGreaterThan(6)
  })

  it("fails closed for degenerate angular manipulator frames", () => {
    expect(
      viewerAngularGizmoPoint({
        angle: 1,
        axisDirection: [0, 0, 0],
        axisOrigin: [0, 0, 0],
        rotationOrigin: [1, 0, 0],
      }),
    ).toBeNull()
    expect(
      viewerAngularGizmoAngle(
        {
          angle: 1,
          axisDirection: [0, 0, 1],
          axisOrigin: [0, 0, 0],
          rotationOrigin: [0, 0, 2],
        },
        [1, 0, 0],
      ),
    ).toBeNull()
  })

  it("orders and deduplicates saved profiles by stable selector identity", () => {
    const first = {
      selector: profileSelector("sketch", "outer-a"),
      outerPositions: new Float32Array([0, 0, 2, 0, 0, 2]),
      holePositions: [],
    }
    const duplicate = { ...first, outerPositions: new Float32Array(first.outerPositions) }
    const second = { ...first, selector: profileSelector("sketch", "outer-b") }
    expect(
      orderedUniqueViewerSketchProfiles([
        { profile: second, distance: 1 },
        { profile: duplicate, distance: 0.5 },
        { profile: first, distance: 0.5 },
      ]),
    ).toEqual([first, second])
    expect(viewerSketchProfileKey(first.selector)).toBe(viewerSketchProfileKey(duplicate.selector))
  })

  it("caps saved profile candidates after nearest-first deterministic dedupe", () => {
    const profiles = Array.from({ length: 10 }, (_, index) => ({
      selector: profileSelector("sketch", `outer-${index}`),
      outerPositions: new Float32Array([0, 0, 2, 0, 0, 2]),
      holePositions: [],
    }))
    expect(
      orderedUniqueViewerSketchProfiles(
        [...profiles].reverse().map((profile, index) => ({
          profile,
          distance: index < 2 ? 1 : index + 1,
        })),
      ),
    ).toEqual([profiles[8], profiles[9], ...profiles.slice(2, 8).reverse()])
  })

  it("triangulates profile holes and maps local coordinates through its frame", () => {
    const geometry = createViewerSketchProfileGeometry(
      {
        selector: profileSelector("sketch", "outer"),
        outerPositions: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
        holePositions: [new Float32Array([2, 2, 2, 8, 8, 8, 8, 2])],
      },
      { origin: [5, 6, 7], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
    )
    expect(geometry).not.toBeNull()
    expect(geometry?.getAttribute("position").count).toBe(8)
    expect(geometry?.index?.count).toBeGreaterThan(0)
    expect(geometry?.getAttribute("position").array.slice(0, 3)).toEqual(
      new Float32Array([5, 6, 7]),
    )
    geometry?.dispose()
  })
  it("orders, deduplicates, and caps support face candidates deterministically", () => {
    const selections = orderedUniqueViewerSelections([
      { distance: 3, selection: { featureId: "feature-b", faceId: 4, faceOrdinal: 1 } },
      { distance: 1, selection: { featureId: "feature-z", faceId: 8, faceOrdinal: 2 } },
      { distance: 1, selection: { featureId: "feature-a", faceId: 9, faceOrdinal: 2 } },
      { distance: 1, selection: { featureId: "feature-a", faceId: 7, faceOrdinal: 1 } },
      { distance: 0.5, selection: { featureId: "feature-a", faceId: 7, faceOrdinal: 1 } },
      ...Array.from({ length: 10 }, (_, index) => ({
        distance: 4,
        selection: { featureId: `feature-${index + 10}`, faceId: index, faceOrdinal: 1 },
      })),
    ])

    expect(selections).toHaveLength(8)
    expect(selections.slice(0, 4)).toEqual([
      { featureId: "feature-a", faceId: 7, faceOrdinal: 1 },
      { featureId: "feature-a", faceId: 9, faceOrdinal: 2 },
      { featureId: "feature-z", faceId: 8, faceOrdinal: 2 },
      { featureId: "feature-b", faceId: 4, faceOrdinal: 1 },
    ])
    expect(new Set(selections.map(({ featureId, faceId }) => `${featureId}:${faceId}`)).size).toBe(
      8,
    )
  })

  it("filters unsupported faces before applying the support candidate cap", () => {
    const unsupported = Array.from({ length: 9 }, (_, index) => ({
      distance: index + 1,
      selection: { featureId: `unsupported-${index}`, faceId: index, faceOrdinal: index + 1 },
    }))
    const eligible = {
      distance: 10,
      selection: { featureId: "eligible", faceId: 42, faceOrdinal: 1 },
    }

    expect(
      orderedEligibleViewerSelections(
        [...unsupported, eligible],
        ({ featureId }) => featureId === "eligible",
      ),
    ).toEqual([eligible.selection])
  })

  it("accepts orthonormal right-handed frames, including origin-plane orientations", () => {
    expect(
      isValidViewerFrame({
        origin: [3, -2, 8],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      }),
    ).toBe(true)
    expect(
      isValidViewerFrame({
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 0, 1],
        normal: [0, -1, 0],
      }),
    ).toBe(true)
  })

  it("rejects non-finite, non-orthonormal, and left-handed frames", () => {
    const frame = {
      origin: [0, 0, 0] as const,
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 1, 0] as const,
      normal: [0, 0, 1] as const,
    }
    expect(isValidViewerFrame({ ...frame, normal: [0, 0, Number.NaN] })).toBe(false)
    expect(isValidViewerFrame({ ...frame, yAxis: [0, 1, 0.01] })).toBe(false)
    expect(isValidViewerFrame({ ...frame, normal: [0, 0, -1] })).toBe(false)
    expect(isValidViewerFrame(null as never)).toBe(false)
  })

  it("derives a pose at the retained camera distance", () => {
    const pose = viewerCameraPoseForFrame(
      { origin: [4, 5, 6], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      37,
    )
    expect(pose).toEqual({
      position: [4, 5, 43],
      target: [4, 5, 6],
      up: [0, 1, 0],
    })
    expect(viewerCameraPoseForFrame({} as never, 37)).toBeNull()
  })

  it("assigns stable display colors to independent terminal feature identities", () => {
    expect(viewerBodyColor("body-a")).toBe(viewerBodyColor("body-a"))
    expect(viewerBodyColor("body-a")).not.toBe(viewerBodyColor("body-b"))
    expect(viewerBodyColor("body-a")).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("binds transferred typed arrays without copying and retains face ownership metadata", () => {
    const geometry = createViewerGeometry(mesh)

    expect(geometry.getAttribute("position").array).toBe(mesh.positions)
    expect(geometry.getAttribute("normal").array).toBe(mesh.normals)
    expect(geometry.index?.array).toBe(mesh.indices)
    expect(geometry.userData).toEqual({ featureId: "box", triangleFaceIds: mesh.triangleFaceIds })
    expect(geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0])
    expect(geometry.boundingBox?.max.toArray()).toEqual([2, 3, 0])

    const disposed = vi.fn()
    geometry.addEventListener("dispose", disposed)
    geometry.dispose()
    expect(disposed).toHaveBeenCalledOnce()
  })

  it("binds transferred sketch positions without copying", () => {
    const positions = new Float32Array([0, 0, 0, 12, 0, 0])
    const geometry = createViewerSketchGeometry(positions)

    expect(geometry.getAttribute("position").array).toBe(positions)
    expect(geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0])
    expect(geometry.boundingBox?.max.toArray()).toEqual([12, 0, 0])

    geometry.dispose()
  })

  it("shares one stable identity for sketch and model reference candidates", () => {
    const point = {
      label: "Point",
      position: [0, 0, 0] as const,
      sourcePointId: "point-1",
      sourceSketchId: "sketch-1",
    }
    expect(viewerSketchReferenceCandidateKey(point)).toBe("sketch-1:point-1")
    expect(viewerSketchReferenceCandidateKey({ ...point, kind: "point" })).toBe("sketch-1:point-1")
    expect(
      viewerSketchReferenceCandidateKey({
        candidateId: "edge-1",
        featureId: "box-1",
        kind: "model-line",
      }),
    ).toBe("model-line:box-1:edge-1")
  })

  it("keeps a valid orthographic projection for measured and zero-sized viewports", () => {
    expect(orthographicFrustum(40, 2)).toEqual({
      left: -40,
      right: 40,
      top: 20,
      bottom: -20,
    })
    expect(orthographicFrustum(0, 0)).toEqual({
      left: -50,
      right: 50,
      top: 50,
      bottom: -50,
    })
  })

  it("derives Z-up standard views without moving the orbit target or changing distance", () => {
    expect(viewerCameraPoseForStandardView("front", [10, 20, 30], 50)).toEqual({
      position: [10, -30, 30],
      target: [10, 20, 30],
      up: [0, 0, 1],
    })
    expect(viewerCameraPoseForStandardView("top", [10, 20, 30], 50)).toEqual({
      position: [10, 20, 80],
      target: [10, 20, 30],
      up: [0, 1, 0],
    })
    const isometric = viewerCameraPoseForStandardView("isometric", [0, 0, 0], 25)
    expect(isometric?.target).toEqual([0, 0, 0])
    expect(Math.hypot(...(isometric?.position ?? []))).toBeCloseTo(25)
    expect(viewerCameraPoseForStandardView("right", [0, Number.NaN, 0], 25)).toBeNull()
    expect(viewerCameraPoseForStandardView("right", [0, 0, 0], 0)).toBeNull()
  })

  it("matches SVG meet scaling for sketch projection bounds", () => {
    const bounds = { minX: -10, minY: -5, width: 20, height: 10 }
    expect(viewerSketchProjectionViewHeight(bounds, 2)).toBe(10)
    expect(viewerSketchProjectionViewHeight(bounds, 1)).toBe(20)
    expect(viewerSketchProjectionViewHeight({ ...bounds, width: Number.NaN }, 2)).toBe(100)
  })

  it("maps a planar projection center through the sketch frame", () => {
    expect(
      viewerSketchProjectionTarget(
        {
          origin: [10, 20, 30],
          xAxis: [0, 1, 0],
          yAxis: [0, 0, 1],
          normal: [1, 0, 0],
        },
        { minX: 2, minY: 4, width: 6, height: 8 },
      ),
    ).toEqual([10, 25, 38])
    expect(
      viewerSketchProjectionTarget(
        {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
        },
        { minX: 0, minY: 0, width: 0, height: 10 },
      ),
    ).toBeNull()
  })

  it("extracts the exact selected face triangles and derives a friendly ordinal", () => {
    const selectableMesh: ViewerMesh = {
      featureId: "box",
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0, 2, 3, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
      triangleFaceIds: new Uint32Array([7, 9]),
    }

    expect(viewerFaceOrdinal(selectableMesh, 7)).toBe(1)
    expect(viewerFaceOrdinal(selectableMesh, 9)).toBe(2)
    expect(viewerFaceOrdinal(selectableMesh, 11)).toBeNull()

    const highlight = createFaceHighlightGeometry(selectableMesh, 9)
    expect(Array.from(highlight?.getAttribute("position").array ?? [])).toEqual([
      0, 3, 0, 2, 0, 0, 2, 3, 0,
    ])
    expect(createFaceHighlightGeometry(selectableMesh, 11)).toBeNull()
    highlight?.dispose()
  })
})
