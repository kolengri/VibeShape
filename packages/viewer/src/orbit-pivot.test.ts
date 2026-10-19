import { describe, expect, it } from "bun:test"
import { OrthographicCamera, Vector3 } from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { preserveOrbitPivot } from "./orbit-pivot"

const pivot = new Vector3(110, -70, 45)
const vertices = [-10, 10].flatMap((x) =>
  [-10, 10].flatMap((y) => [-10, 10].map((z) => pivot.clone().add(new Vector3(x, y, z)))),
)

function fixture() {
  const camera = new OrthographicCamera(-200 / 3, 200 / 3, 50, -50, 0.01, 10_000)
  camera.up.set(0, 0, 1)
  camera.position.copy(pivot).add(new Vector3(80, -80, 65))
  const element = Object.assign(new EventTarget(), {
    clientWidth: 640,
    clientHeight: 480,
    style: { touchAction: "" },
    ownerDocument: new EventTarget(),
    getRootNode() {
      return this.ownerDocument
    },
  })
  const controls = new OrbitControls(camera, element as unknown as HTMLElement)
  controls.target.copy(pivot)
  controls.update()
  camera.updateMatrixWorld()
  return { camera, controls }
}

function screen(camera: OrthographicCamera, point: Vector3) {
  return point
    .clone()
    .project(camera)
    .multiply(new Vector3(320, -240, 0))
    .add(new Vector3(320, 240, 0))
}

function orbit(state: ReturnType<typeof fixture>) {
  const orientation = state.camera.quaternion.clone()
  const before = vertices.map((point) => screen(state.camera, point))
  state.controls.rotateLeft(Math.PI / 20)
  preserveOrbitPivot(state.camera, state.controls.target, pivot, orientation)
  return vertices.map((point, index) => {
    const previous = before[index]
    if (!previous) throw new Error("The vertex projection fixture is incomplete.")
    return screen(state.camera, point).sub(previous)
  })
}

describe("model orbit pivot", () => {
  it("keeps an off-center model fixed on screen without changing angular motion", () => {
    const centered = fixture()
    const displaced = fixture()
    try {
      const offset = new Vector3(33, 58, 30)
      displaced.camera.position.add(offset)
      displaced.controls.target.add(offset)
      displaced.controls.update()
      displaced.camera.updateMatrixWorld()
      const centerBefore = screen(displaced.camera, pivot)
      const angleBefore = displaced.controls.getAzimuthalAngle()
      const centeredMotion = orbit(centered)
      const displacedMotion = orbit(displaced)
      expect(displaced.controls.getAzimuthalAngle() - angleBefore).toBeCloseTo(-Math.PI / 20, 12)
      expect(screen(displaced.camera, pivot).distanceTo(centerBefore)).toBeLessThan(1e-10)
      for (const [index, motion] of displacedMotion.entries()) {
        const reference = centeredMotion[index]
        if (!reference) throw new Error("The centered motion fixture is incomplete.")
        expect(motion.distanceTo(reference)).toBeLessThan(1e-10)
      }
    } finally {
      centered.controls.dispose()
      displaced.controls.dispose()
    }
  })

  it("leaves pan and wheel-only orientation unchanged", () => {
    const { camera, controls } = fixture()
    try {
      const orientation = camera.quaternion.clone()
      controls.pan(40, -20)
      controls.dollyIn(0.5)
      const position = camera.position.clone()
      const target = controls.target.clone()
      preserveOrbitPivot(camera, controls.target, pivot, orientation)
      expect(camera.position.toArray()).toEqual(position.toArray())
      expect(controls.target.toArray()).toEqual(target.toArray())
      expect(camera.zoom).toBe(2)
    } finally {
      controls.dispose()
    }
  })

  it("preserves clipping retreat and repeated finite rotations", () => {
    const state = fixture()
    try {
      state.camera.position.addScaledVector(state.camera.getWorldDirection(new Vector3()), -5_000)
      state.controls.update()
      state.camera.updateMatrixWorld()
      const distance = state.controls.getDistance()
      const center = screen(state.camera, pivot)
      for (let index = 0; index < 40; index += 1) {
        orbit(state)
        expect(state.camera.position.toArray().every(Number.isFinite)).toBe(true)
        expect(state.controls.target.toArray().every(Number.isFinite)).toBe(true)
      }
      expect(state.controls.getDistance()).toBeCloseTo(distance, 8)
      expect(screen(state.camera, pivot).distanceTo(center)).toBeLessThan(1e-8)
    } finally {
      state.controls.dispose()
    }
  })
})
