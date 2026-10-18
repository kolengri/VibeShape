import { describe, expect, it } from "bun:test"
import {
  type BufferGeometry,
  LineSegments,
  type Material,
  Mesh,
  PerspectiveCamera,
  Vector3,
} from "three"
import { OrientationMarker } from "./orientation-marker"

function ownedResources(marker: OrientationMarker) {
  const resources = new Set<BufferGeometry | Material>()
  marker.group.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return
    resources.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.add(material)
    }
  })
  return resources
}

describe("World orientation marker", () => {
  it("places lettered discs at positive world endpoints and smaller hollow markers opposite them", () => {
    const marker = new OrientationMarker()
    try {
      const positions: [number, number, number][] = [
        [0.62, 0, 0],
        [0, 0.62, 0],
        [0, 0, 0.62],
      ]
      for (const [index, axis] of ["X", "Y", "Z"].entries()) {
        const positive = marker.group.getObjectByName(axis)
        const negative = marker.group.getObjectByName(`-${axis}`)
        expect(positive?.position.toArray()).toEqual(positions[index])
        expect(negative?.position.toArray().map((value) => Math.abs(value))).toEqual(
          positions[index],
        )
        expect(
          negative?.position
            .clone()
            .add(positive?.position ?? new Vector3())
            .length(),
        ).toBe(0)
        expect(positive?.children).toHaveLength(3)
        expect(negative?.children).toHaveLength(1)
        const glyph = positive?.children[2]
        expect(glyph instanceof Mesh && glyph.geometry.getAttribute("position").count > 0).toBe(
          true,
        )
      }
    } finally {
      marker.dispose()
    }
  })

  it("keeps every endpoint glyph facing the orientation camera and inside the 80-pixel inset", () => {
    const marker = new OrientationMarker()
    const camera = new PerspectiveCamera(35, 1, 0.1, 10)
    camera.up.set(0, 0, 1)
    try {
      for (const direction of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
        [1, -1, 1],
        [-1, 1, -1],
      ]) {
        camera.position.fromArray(direction).normalize().multiplyScalar(3)
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld()
        marker.alignLabels(camera.quaternion)
        marker.group.updateMatrixWorld(true)
        let maxScreenExtent = 0
        let minDepth = 1
        let maxDepth = -1
        for (const axis of ["X", "Y", "Z", "-X", "-Y", "-Z"]) {
          const label = marker.group.getObjectByName(axis)
          expect(label?.quaternion.angleTo(camera.quaternion)).toBeLessThan(1e-7)
          label?.traverse((object) => {
            if (!(object instanceof Mesh)) return
            const vertices = object.geometry.getAttribute("position")
            for (let index = 0; index < vertices.count; index++) {
              const projected = new Vector3()
                .fromBufferAttribute(vertices, index)
                .applyMatrix4(object.matrixWorld)
                .project(camera)
              maxScreenExtent = Math.max(
                maxScreenExtent,
                Math.abs(projected.x),
                Math.abs(projected.y),
              )
              minDepth = Math.min(minDepth, projected.z)
              maxDepth = Math.max(maxDepth, projected.z)
            }
          })
        }
        expect(maxScreenExtent).toBeLessThan(1)
        expect(minDepth).toBeGreaterThan(-1)
        expect(maxDepth).toBeLessThan(1)
      }
    } finally {
      marker.dispose()
    }
  })

  it("reuses geometry and materials during camera updates and disposes shared resources exactly once", () => {
    const marker = new OrientationMarker()
    const resources = ownedResources(marker)
    const disposalCounts = new Map([...resources].map((resource) => [resource, 0]))
    for (const resource of resources) {
      resource.addEventListener("dispose", () => {
        disposalCounts.set(resource, (disposalCounts.get(resource) ?? 0) + 1)
      })
    }
    const camera = new PerspectiveCamera()
    for (const direction of [
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
    ]) {
      camera.position.fromArray(direction)
      camera.lookAt(0, 0, 0)
      marker.alignLabels(camera.quaternion)
    }
    expect(ownedResources(marker)).toEqual(resources)
    expect([...disposalCounts.values()].every((count) => count === 0)).toBe(true)
    marker.dispose()
    marker.dispose()
    expect([...disposalCounts.values()].every((count) => count === 1)).toBe(true)
  })
})
