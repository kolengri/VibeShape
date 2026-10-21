import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  LineSegments,
  Mesh,
  OrthographicCamera,
  ShaderMaterial,
  Vector3,
} from "three"
import { vi } from "../../../tests/unit/support/bun-test"
import { SectionViewDecoration, sectionDragDirection } from "./section-view-decoration"
import type { ViewerMesh } from "./three-viewport"

describe("section normal drag projection", () => {
  it.each(["x", "y", "z"] as const)(
    "moves one world unit for one projected %s-axis unit",
    (axis) => {
      const camera = new OrthographicCamera(-50, 50, 50, -50, 0.01, 10000)
      camera.up.set(0, 0, 1)
      camera.position.set(80, -80, 65)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      const direction = sectionDragDirection(axis, camera, 1000, 1000)
      const start = new Vector3().project(camera)
      const end = new Vector3().setComponent({ x: 0, y: 1, z: 2 }[axis], 1).project(camera)
      const delta = direction.x * (end.x - start.x) * 500 - direction.y * (end.y - start.y) * 500
      expect(delta).toBeCloseTo(1, 6)
    },
  )
  it("uses bounded vertical motion when looking along the section normal", () => {
    const camera = new OrthographicCamera(-50, 50, 50, -50, 0.01, 10000)
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const direction = sectionDragDirection("z", camera, 1000, 1000)
    expect(direction.x).toBe(0)
    expect(direction.y).toBeCloseTo(-0.1)
    expect(Number.isFinite(sectionDragDirection("z", camera, 0, 0).y)).toBe(true)
  })
})

function sectionMesh(width = 10, height = 10, depth = 10, origin = new Vector3()): ViewerMesh {
  const geometry = new BoxGeometry(width, height, depth).translate(origin.x, origin.y, origin.z)
  const index = geometry.getIndex()
  if (!index) throw new Error("The section fixture must be indexed.")
  const indices = new Uint32Array(index.array)
  const source: ViewerMesh = {
    featureId: "section-fixture",
    positions: new Float32Array(geometry.getAttribute("position").array),
    normals: new Float32Array(geometry.getAttribute("normal").array),
    indices,
    triangleFaceIds: new Uint32Array(indices.length / 3),
  }
  geometry.dispose()
  return source
}

function decorationFixture() {
  const canvas = Object.assign(new EventTarget(), {
    clientWidth: 1000,
    clientHeight: 1000,
    dataset: {} as Record<string, string>,
    style: { cursor: "" },
    hasPointerCapture: () => false,
  })
  const camera = new OrthographicCamera(-50, 50, 50, -50, 0.01, 10000)
  camera.up.set(0, 0, 1)
  camera.position.set(80, -80, 65)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const decoration = new SectionViewDecoration({
    canvas: canvas as unknown as HTMLCanvasElement,
    camera,
    canInteract: () => true,
    navigationEnabled: () => true,
    setNavigationEnabled: () => undefined,
    onChange: () => undefined,
    render: () => undefined,
  })
  decoration.setMeshes([sectionMesh()])
  decoration.setSection({ axis: "z", offset: 0, flipped: false })
  const [, plane, outline, stem, handle] = decoration.group.children
  if (
    !(plane instanceof Mesh) ||
    !(outline instanceof LineSegments) ||
    !(stem instanceof LineSegments) ||
    !(handle instanceof Mesh)
  )
    throw new Error("The section decoration must expose its plane, outline, stem, and handle.")
  return { decoration, canvas, camera, plane, outline, stem, handle }
}

function positionState(object: Mesh | LineSegments) {
  const attribute = object.geometry.getAttribute("position")
  if (!(attribute instanceof BufferAttribute))
    throw new Error("The section decoration requires a position buffer.")
  return {
    geometry: object.geometry,
    attribute,
    array: attribute.array,
    values: [...attribute.array],
    version: attribute.version,
  }
}

function expectRetainedPosition(state: ReturnType<typeof positionState>) {
  expect(state.geometry.getAttribute("position")).toBe(state.attribute)
  expect(state.attribute.array).toBe(state.array)
}

function expectUnchangedPosition(state: ReturnType<typeof positionState>) {
  expectRetainedPosition(state)
  expect(state.attribute.version).toBe(state.version)
  expect([...state.array]).toEqual(state.values)
}

function expectPlaneCoordinate(attribute: BufferAttribute, coordinate: number, value: number) {
  for (let index = 0; index < attribute.count; index += 1)
    expect(attribute.getComponent(index, coordinate)).toBeCloseTo(value)
}

describe("retained section decoration geometry", () => {
  beforeEach(() => vi.stubGlobal("window", new EventTarget()))
  afterEach(() => vi.unstubAllGlobals())

  it("keeps the cut grid in the section plane and adapts its spacing without rebuilding caps", () => {
    const { decoration, camera } = decorationFixture()
    try {
      for (const [axis, u, v] of [
        ["x", [0, 1, 0], [0, 0, 1]],
        ["y", [1, 0, 0], [0, 0, 1]],
        ["z", [1, 0, 0], [0, 1, 0]],
      ] as const) {
        camera.zoom = 1
        decoration.setSection({ axis, offset: 0, flipped: false })
        const cap = decoration.group.children[0]?.children[0]
        if (!(cap instanceof Mesh) || !(cap.material instanceof ShaderMaterial))
          throw new Error("A closed section must have a grid material.")
        const material = cap.material
        expect(material.uniforms.sectionU?.value.toArray()).toEqual([...u])
        expect(material.uniforms.sectionV?.value.toArray()).toEqual([...v])
        expect(material.uniforms.spacing?.value).toBeCloseTo(1)
        camera.zoom = 2
        decoration.update()
        expect(material.uniforms.spacing?.value).toBeCloseTo(0.5)
        expect(decoration.group.children[0]?.children[0]).toBe(cap)
        expect(cap.material).toBe(material)
      }
    } finally {
      decoration.dispose()
    }
  })

  it("accepts retained model bounds without reading vertices when the section is inactive", () => {
    const { decoration } = decorationFixture()
    try {
      decoration.setSection(null)
      const source = sectionMesh()
      const bounded = {
        ...source,
        get positions(): Float32Array {
          throw new Error("Retained bounds must avoid a vertex scan.")
        },
      }
      const bounds = new Box3(new Vector3(-5, -5, -5), new Vector3(5, 5, 5))
      decoration.setMeshes([bounded], bounds)
      expect(decoration.group.visible).toBe(false)
      decoration.setMeshes([source], bounds)
      bounds.makeEmpty()
      decoration.setSection({ axis: "z", offset: 0, flipped: false })
      expect(decoration.group.visible).toBe(true)
      expect(decoration.group.children[0]?.children).toHaveLength(1)
    } finally {
      decoration.dispose()
    }
  })

  it("refreshes projected handles across orbit and width changes without reallocating or uploading world geometry", () => {
    const { decoration, canvas, camera, plane, outline, stem } = decorationFixture()
    const states = [plane, outline, stem].map(positionState)
    const projection = canvas.dataset.sectionGizmoHandle
    for (let index = 0; index < 3; index += 1) {
      camera.position.set(80 + index * 10, 80, 65)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      decoration.update()
    }
    expect(canvas.dataset.sectionGizmoHandle).not.toBe(projection)
    const orbitProjection = canvas.dataset.sectionGizmoHandle
    canvas.clientWidth = 1400
    decoration.update()
    expect(canvas.dataset.sectionGizmoHandle).not.toBe(orbitProjection)
    for (const state of states) expectUnchangedPosition(state)
    decoration.dispose()
  })

  it("updates retained positions for section offsets and axes while a halfspace flip leaves the plane unchanged", () => {
    const { decoration, canvas, plane, outline, stem } = decorationFixture()
    const states = [plane, outline, stem].map(positionState)
    decoration.setSection({ axis: "z", offset: 2, flipped: false })
    for (const state of states) {
      expectRetainedPosition(state)
      expect(state.attribute.version).toBe(state.version + 1)
    }
    expectPlaneCoordinate(positionState(plane).attribute, 2, 2)
    expect(positionState(stem).attribute.getZ(1)).toBeCloseTo(5)
    decoration.setSection({ axis: "x", offset: 2, flipped: false })
    expectPlaneCoordinate(positionState(plane).attribute, 0, 2)
    expect(positionState(stem).attribute.getX(1)).toBeCloseTo(5)
    const beforeFlip = [plane, outline, stem].map(positionState)
    decoration.setSection({ axis: "x", offset: 2, flipped: true })
    for (const state of beforeFlip) expectUnchangedPosition(state)
    expect(canvas.dataset.sectionCapCount).toBe("1")
    decoration.dispose()
  })

  it("updates screen-sized plane padding and handle size only when camera scale or viewport height changes", () => {
    const { decoration, canvas, camera, plane, outline, stem, handle } = decorationFixture()
    const states = [plane, outline, stem].map(positionState)
    camera.zoom = 2
    camera.updateProjectionMatrix()
    decoration.update()
    expect(positionState(plane).attribute.getX(0)).toBeCloseTo(-5.9)
    expect(positionState(stem).attribute.getZ(1)).toBeCloseTo(1.5)
    expect(handle.scale.x).toBeCloseTo(0.35)
    canvas.clientHeight = 500
    decoration.update()
    expect(positionState(plane).attribute.getX(0)).toBeCloseTo(-6.8)
    expect(handle.scale.x).toBeCloseTo(0.7)
    for (const state of states) {
      expectRetainedPosition(state)
      expect(state.attribute.version).toBe(state.version + 2)
    }
    decoration.dispose()
  })

  it("updates world bounds for resized and translated meshes and skips an equivalent bounds refresh", () => {
    const { decoration, plane, outline, stem } = decorationFixture()
    const states = [plane, outline, stem].map(positionState)
    decoration.setMeshes([sectionMesh(20, 30, 40, new Vector3(1, 2, 3))])
    expect(positionState(plane).attribute.getX(0)).toBeCloseTo(-10.8)
    expect(positionState(plane).attribute.getY(0)).toBeCloseTo(-14.8)
    decoration.setMeshes([sectionMesh(20, 30, 40, new Vector3(8, 9, 10))])
    expect(positionState(plane).attribute.getX(0)).toBeCloseTo(-3.8)
    expect(positionState(plane).attribute.getY(0)).toBeCloseTo(-7.8)
    for (const state of states) {
      expectRetainedPosition(state)
      expect(state.attribute.version).toBe(state.version + 2)
    }
    const beforeEquivalent = [plane, outline, stem].map(positionState)
    decoration.setMeshes([sectionMesh(20, 30, 40, new Vector3(8, 9, 10))])
    for (const state of beforeEquivalent) expectUnchangedPosition(state)
    decoration.dispose()
  })

  it("releases retained geometry, materials, caps, and projected handle state on disposal", () => {
    const { decoration, canvas } = decorationFixture()
    const released: ReturnType<typeof vi.fn>[] = []
    decoration.group.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof LineSegments)) return
      for (const resource of [object.geometry, object.material].flat()) {
        const onDispose = vi.fn()
        resource.addEventListener("dispose", onDispose)
        released.push(onDispose)
      }
    })
    decoration.update()
    decoration.dispose()
    for (const onDispose of released) expect(onDispose).toHaveBeenCalledTimes(1)
    expect(decoration.group.children).toHaveLength(0)
    expect(canvas.dataset.sectionGizmoHandle).toBeUndefined()
    expect(canvas.dataset.sectionCapCount).toBeUndefined()
  })
})
