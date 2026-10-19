import { describe, expect, it, mock } from "bun:test"
import { BufferAttribute, OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from "three"
import { InfiniteGridDecoration } from "./infinite-grid"

function numericUniformValues(value: unknown): number[] {
  if (value instanceof Vector2 || value instanceof Vector3) return value.toArray()
  return typeof value === "number" ? [value] : []
}

function cameraAt(position: Vector3, target = new Vector3(), zoom = 1) {
  const camera = new OrthographicCamera(-80, 80, 60, -60, 0.01, 10_000)
  camera.up.set(0, 0, 1)
  if (position.x === target.x && position.y === target.y) camera.up.set(0, 1, 0)
  camera.position.copy(position)
  camera.lookAt(target)
  camera.zoom = zoom
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return camera
}

function gridProjection(grid: InfiniteGridDecoration, x: number, y: number) {
  const uniforms = grid.mesh.material.uniforms
  const origin = uniforms.gridOrigin?.value as Vector2
  const right = uniforms.gridRight?.value as Vector2
  const up = uniforms.gridUp?.value as Vector2
  return origin.clone().addScaledVector(right, x).addScaledVector(up, y)
}

function phaseError(left: number, right: number, period: number) {
  const difference = (((left - right) % period) + period) % period
  return Math.min(difference, period - difference)
}

describe("infinite XY background grid", () => {
  it("maps every viewport edge onto the world XY plane through orbit, large pan, and zoom", () => {
    const grid = new InfiniteGridDecoration()
    grid.setEnabled(true)
    const raycaster = new Raycaster()
    const plane = new Plane(new Vector3(0, 0, 1), 0)
    const hit = new Vector3()
    const cameras = [
      cameraAt(new Vector3(0, 0, 100)),
      cameraAt(new Vector3(80, -80, 65)),
      cameraAt(new Vector3(100, 0, 5)),
      cameraAt(
        new Vector3(1_000_000_000.125, -999_999_999.625, 650),
        new Vector3(1_000_000_000.125, -999_999_999.625, 0),
        2.4,
      ),
      cameraAt(new Vector3(-200, 100, -120), new Vector3(-200, 100, 0), 0.03),
    ]
    try {
      for (const camera of cameras) {
        grid.update(camera, 800, 600, 2)
        expect(grid.mesh.visible).toBe(true)
        const spacing = grid.mesh.material.uniforms.gridSpacing?.value as number
        const period = spacing * 100
        for (const x of [-1, 0, 1]) {
          for (const y of [-1, 0, 1]) {
            raycaster.setFromCamera(new Vector2(x, y), camera)
            // Some near-horizon rays meet the plane behind the camera; the shader discards those.
            if (!raycaster.ray.intersectPlane(plane, hit)) continue
            const projected = gridProjection(grid, x, y)
            expect(phaseError(projected.x, hit.x, period)).toBeLessThan(spacing * 0.00001)
            expect(phaseError(projected.y, hit.y, period)).toBeLessThan(spacing * 0.00001)
            expect(hit.z).toBeCloseTo(0, 8)
          }
        }
      }
    } finally {
      grid.dispose()
    }
  })

  it("keeps world line phases stable when a large pan moves the same point across the viewport", () => {
    const grid = new InfiniteGridDecoration()
    grid.setEnabled(true)
    const target = new Vector3(1_000_000_000, -1_000_000_000, 0)
    const camera = cameraAt(target.clone().add(new Vector3(80, -80, 65)), target)
    const point = target.clone().add(new Vector3(3.75, 8.125, 0))
    try {
      grid.update(camera, 800, 600)
      const beforeScreen = point.clone().project(camera)
      const before = gridProjection(grid, beforeScreen.x, beforeScreen.y)
      camera.position.add(new Vector3(13.25, -7.5, 0))
      camera.updateMatrixWorld()
      grid.update(camera, 800, 600)
      const afterScreen = point.clone().project(camera)
      const after = gridProjection(grid, afterScreen.x, afterScreen.y)
      const period = (grid.mesh.material.uniforms.gridSpacing?.value as number) * 100
      expect(phaseError(before.x, after.x, period)).toBeLessThan(0.000001)
      expect(phaseError(before.y, after.y, period)).toBeLessThan(0.000001)
    } finally {
      grid.dispose()
    }
  })

  it("fades near the horizon and rejects parallel, malformed, or empty projections without NaN uniforms", () => {
    const grid = new InfiniteGridDecoration()
    grid.setEnabled(true)
    try {
      grid.update(cameraAt(new Vector3(0, 0, 100)), 800, 600)
      expect(grid.mesh.material.uniforms.gridFade?.value).toBe(1)
      grid.update(cameraAt(new Vector3(100, 0, 5)), 800, 600)
      expect(grid.mesh.visible).toBe(true)
      expect(grid.mesh.material.uniforms.gridFade?.value).toBeGreaterThan(0)
      expect(grid.mesh.material.uniforms.gridFade?.value).toBeLessThan(0.1)
      for (const position of [
        new Vector3(100, 0, 0),
        new Vector3(100, 0, 0.001),
        new Vector3(Number.NaN, 0, 100),
      ]) {
        grid.update(cameraAt(position), 800, 600)
        expect(grid.mesh.visible).toBe(false)
      }
      const camera = cameraAt(new Vector3(0, 0, 100))
      for (const dimensions of [
        [0, 600],
        [800, 0],
        [Number.NaN, 600],
        [Number.POSITIVE_INFINITY, 600],
      ] as const) {
        grid.update(camera, dimensions[0], dimensions[1])
        expect(grid.mesh.visible).toBe(false)
      }
      camera.zoom = 0
      grid.update(camera, 800, 600)
      expect(grid.mesh.visible).toBe(false)
      for (const uniform of Object.values(grid.mesh.material.uniforms)) {
        expect(numericUniformValues(uniform.value).every(Number.isFinite)).toBe(true)
      }
    } finally {
      grid.dispose()
    }
  })

  it("selects nested decade levels while preserving the smooth blend phase across tenfold zoom", () => {
    const grid = new InfiniteGridDecoration()
    grid.setEnabled(true)
    const camera = cameraAt(new Vector3(0, 0, 100))
    try {
      grid.update(camera, 800, 600)
      const spacing = grid.mesh.material.uniforms.gridSpacing?.value as number
      const blend = grid.mesh.material.uniforms.gridBlend?.value as number
      camera.zoom /= 10
      camera.updateProjectionMatrix()
      grid.update(camera, 800, 600)
      expect(grid.mesh.material.uniforms.gridSpacing?.value).toBe(spacing * 10)
      expect(grid.mesh.material.uniforms.gridBlend?.value).toBeCloseTo(blend, 12)
      expect(blend).toBeGreaterThanOrEqual(0)
      expect(blend).toBeLessThan(1)
    } finally {
      grid.dispose()
    }
  })

  it("retains one quad, material, uniform objects, and GPU buffers across navigation and toggles", () => {
    const grid = new InfiniteGridDecoration()
    const camera = cameraAt(new Vector3(0, 0, 100))
    const geometry = grid.mesh.geometry
    const positions = geometry.getAttribute("position")
    const material = grid.mesh.material
    const uniforms = material.uniforms
    const origin = uniforms.gridOrigin?.value
    try {
      for (let i = 0; i < 100; i++) {
        grid.setEnabled(i % 3 !== 0)
        camera.position.x += 10_000
        camera.zoom = 0.1 + i / 10
        camera.updateProjectionMatrix()
        grid.update(camera, 800, 600)
      }
      expect(grid.mesh.geometry).toBe(geometry)
      expect(grid.mesh.material).toBe(material)
      expect(material.uniforms).toBe(uniforms)
      expect(uniforms.gridOrigin?.value).toBe(origin)
      expect(geometry.getAttribute("position")).toBe(positions)
      expect(positions.count).toBe(4)
      expect(geometry.index?.count).toBe(6)
      expect(positions).toBeInstanceOf(BufferAttribute)
      if (positions instanceof BufferAttribute) expect(positions.version).toBe(0)
      expect(grid.mesh.children).toHaveLength(0)
      expect(material.depthTest).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(
        new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1)).intersectObject(grid.mesh),
      ).toEqual([])
      grid.setEnabled(false)
      grid.update(camera, 800, 600)
      expect(grid.mesh.visible).toBe(false)
    } finally {
      grid.dispose()
    }
  })

  it("disposes each owned GPU resource once and cannot reactivate afterward", () => {
    const grid = new InfiniteGridDecoration()
    const geometryDisposed = mock(() => {})
    const materialDisposed = mock(() => {})
    grid.mesh.geometry.addEventListener("dispose", geometryDisposed)
    grid.mesh.material.addEventListener("dispose", materialDisposed)
    grid.dispose()
    grid.dispose()
    grid.setEnabled(true)
    grid.update(cameraAt(new Vector3(0, 0, 100)), 800, 600)
    expect(geometryDisposed).toHaveBeenCalledTimes(1)
    expect(materialDisposed).toHaveBeenCalledTimes(1)
    expect(grid.mesh.visible).toBe(false)
  })
})
