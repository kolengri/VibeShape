import { describe, expect, it, spyOn } from "bun:test"
import {
  BufferGeometry,
  DoubleSide,
  Frustum,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
} from "three"
import { EdgePresentation } from "./edge-presentation"
import { viewerBodyKey } from "./mesh-geometry"
import { sectionPointVisible } from "./section-view"
import type { ViewerEdgeCandidate, ViewerMesh, ViewerVector3 } from "./three-viewport"

type Body = { source: ViewerMesh; surface: Mesh<BufferGeometry, MeshBasicMaterial> }
type Query = {
  camera: OrthographicCamera
  pointer: Vector2
  width: number
  height: number
  planes?: readonly Plane[] | null
}

function key(candidate: ViewerEdgeCandidate) {
  return JSON.stringify([viewerBodyKey(candidate), candidate.candidateId])
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index]
  if (value === undefined) throw new Error(`Missing fixture value at ${index}.`)
  return value
}

// Frozen unpruned picking algorithm: deliberately does not import the production broad phase.
function unprunedContext(bodies: readonly Body[], q: Query) {
  q.camera.updateMatrixWorld()
  const clipping = [
    ...new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(q.camera.projectionMatrix, q.camera.matrixWorldInverse),
    ).planes,
    ...(q.planes ?? []),
  ]
  const surfaces = bodies
    .filter(({ surface }) => {
      for (let object: Object3D | null = surface; object; object = object.parent)
        if (!object.visible) return false
      return true
    })
    .map(({ surface }) => surface)
  for (const surface of surfaces) surface.updateWorldMatrix(true, false)
  const epsilon = surfaces.reduce((tolerance, surface) => {
    const sphere = surface.geometry.boundingSphere
    return Math.max(tolerance, sphere ? (sphere.center.length() + sphere.radius) * 2 ** -23 : 0)
  }, 1e-7)
  const raycaster = new Raycaster()
  raycaster.near = q.camera.near
  raycaster.far = q.camera.far
  return { ...q, clipping, surfaces, epsilon, raycaster }
}

function unprunedClip(a: Vector3, b: Vector3, planes: readonly Plane[]) {
  for (const plane of planes) {
    const da = plane.distanceToPoint(a)
    const db = plane.distanceToPoint(b)
    if (da < 0 && db < 0) return false
    if (da < 0) a.lerp(b, da / (da - db))
    else if (db < 0) b.lerp(a, db / (db - da))
  }
  return true
}

function unprunedSegment(a: Vector3, b: Vector3, q: ReturnType<typeof unprunedContext>) {
  if (!unprunedClip(a, b, q.clipping)) return null
  const pa = a.clone().project(q.camera)
  const pb = b.clone().project(q.camera)
  const delta = new Vector2(((pb.x - pa.x) * q.width) / 2, ((pb.y - pa.y) * q.height) / 2)
  const offset = new Vector2(
    ((q.pointer.x - pa.x) * q.width) / 2,
    ((q.pointer.y - pa.y) * q.height) / 2,
  )
  const fraction =
    delta.lengthSq() > 0 ? Math.max(0, Math.min(1, offset.dot(delta) / delta.lengthSq())) : 0
  const pixels = offset.sub(delta.multiplyScalar(fraction)).length()
  if (pixels > 6) return null
  const point = a.lerp(b, fraction)
  const projected = point.clone().project(q.camera)
  q.raycaster.setFromCamera(new Vector2(projected.x, projected.y), q.camera)
  const depth = point.clone().sub(q.raycaster.ray.origin).dot(q.raycaster.ray.direction)
  const occluder = q.raycaster
    .intersectObjects(q.surfaces, false)
    .find((hit) => sectionPointVisible(q.planes ?? null, hit.point))
  return occluder && occluder.distance < depth - q.epsilon ? null : { pixels, depth }
}

function unprunedStack(
  candidates: readonly ViewerEdgeCandidate[],
  bodies: readonly Body[],
  q: Query,
) {
  if (Math.min(q.width, q.height) <= 0) return []
  const context = unprunedContext(bodies, q)
  const hits: { candidate: ViewerEdgeCandidate; pixels: number; depth: number }[] = []
  for (const candidate of candidates) {
    const segments: { pixels: number; depth: number }[] = []
    for (let index = 1; index < candidate.points.length; index++) {
      const a = new Vector3(...at(candidate.points, index - 1))
      const b = new Vector3(...at(candidate.points, index))
      const hit = unprunedSegment(a, b, context)
      if (hit) segments.push(hit)
    }
    segments.sort((a, b) => a.pixels - b.pixels || a.depth - b.depth)
    if (segments[0]) hits.push({ candidate, ...segments[0] })
  }
  hits.sort(
    (a, b) =>
      a.pixels - b.pixels || a.depth - b.depth || key(a.candidate).localeCompare(key(b.candidate)),
  )
  return hits.slice(0, 8).map(({ candidate }) => candidate)
}

function model(role = "result", z?: number): Body {
  const geometry =
    z === undefined ? new BufferGeometry() : new PlaneGeometry(100, 100).translate(0, 0, z)
  geometry.computeBoundingSphere()
  return {
    source: {
      featureId: "body",
      outputRole: role,
      positions: new Float32Array(geometry.getAttribute("position")?.array ?? []),
      normals: new Float32Array(geometry.getAttribute("normal")?.array ?? []),
      indices: new Uint32Array(geometry.index?.array ?? []),
      triangleFaceIds: new Uint32Array([1, 1]),
    },
    surface: new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })),
  }
}

function candidate(
  id: string,
  points: readonly ViewerVector3[],
  role = "result",
): ViewerEdgeCandidate {
  return { featureId: "body", outputRole: role, candidateId: id, label: id, points }
}

function camera() {
  const result = new OrthographicCamera(-20, 20, 20, -20, 0.1, 100)
  result.position.set(0, 0, 30)
  result.lookAt(0, 0, 0)
  result.updateMatrixWorld()
  return result
}

function fixture(bodies = [model()]) {
  let stack: readonly ViewerEdgeCandidate[] = []
  const presentation = new EdgePresentation({
    preselection: () => undefined,
    changed: () => undefined,
    stack: (value) => {
      stack = value
    },
  })
  presentation.setBodies(bodies)
  return {
    presentation,
    compare(candidates: readonly ViewerEdgeCandidate[], query: Query) {
      presentation.setClipping(query.planes ?? null)
      presentation.clearPicking()
      const expected = unprunedStack(candidates, bodies, query)
      const picked = presentation.pick(query.camera, query.pointer, query.width, query.height)
      expect(stack.map(key)).toEqual(expected.map(key))
      expect(picked).toBe(expected[0] ?? null)
      return expected
    },
    dispose() {
      presentation.dispose()
      for (const { surface } of bodies) {
        surface.geometry.dispose()
        surface.material.dispose()
      }
    },
  }
}

function random(seed: number) {
  let state = seed
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe("production edge broad phase equivalence", () => {
  it("does not reread installed off-pointer polylines while reacting to camera movement", () => {
    const f = fixture()
    let pointReads = 0
    const points = new Proxy(
      Array.from({ length: 41 }, (_, index): ViewerVector3 => [100 + index / 40, 0, 0]),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) pointReads++
          return Reflect.get(target, property, receiver)
        },
      },
    )
    try {
      const far = candidate("far", points)
      f.presentation.setCandidates([far])
      expect(pointReads).toBeGreaterThan(0)
      pointReads = 0
      const c = camera()
      expect(f.presentation.pick(c, new Vector2(), 400, 400)).toBeNull()
      expect(pointReads).toBe(0)
      c.position.x = 100
      c.lookAt(100, 0, 0)
      expect(f.presentation.pick(c, new Vector2(), 400, 400)).toBe(far)
      expect(pointReads).toBeGreaterThan(0)
    } finally {
      f.dispose()
    }
  })

  it("matches the unpruned stack under deterministic camera, zoom, viewport, polyline, and clipping changes", () => {
    const next = random(0x51a4c3)
    const f = fixture([model("result", -4), model("front", 6)])
    let nonempty = 0
    try {
      for (let scene = 0; scene < 60; scene++) {
        const c = camera()
        c.position.set((next() - 0.5) * 80, (next() - 0.5) * 80, 20 + next() * 60)
        c.up.set(next(), next(), 1)
        c.lookAt(next() * 6, next() * 6, next() * 6)
        c.zoom = at([0.001, 0.05, 0.25, 1, 4, 1000], scene % 6)
        c.left = -5 - next() * 40
        c.right = 5 + next() * 60
        c.top = 5 + next() * 40
        c.bottom = -5 - next() * 60
        c.near = scene % 3 ? 0.1 : 30
        c.far = scene % 3 ? 200 : 60
        c.updateProjectionMatrix()
        c.updateMatrixWorld()
        const candidates = Array.from({ length: 36 }, (_, index) => {
          const center: ViewerVector3 = [
            (next() - 0.5) * 60,
            (next() - 0.5) * 60,
            (next() - 0.5) * 40,
          ]
          const points = Array.from(
            { length: 2 + (index % 9) },
            (): ViewerVector3 =>
              index % 7 === 0
                ? center
                : [center[0] + next() * 12, center[1] + next() * 12, center[2] + next() * 12],
          )
          return candidate(`${index}`, points)
        })
        f.presentation.setCandidates(candidates)
        const planes =
          scene % 2 ? [new Plane(new Vector3(1, -0.4, 0.3).normalize(), (next() - 0.5) * 30)] : null
        const width = at([1, 321, 1200], scene % 3)
        const height = at([800, 177, 1], scene % 3)
        for (let sample = 0; sample < 10; sample++) {
          const point = new Vector3(
            ...at(at(candidates, (sample * 7) % candidates.length).points, 0),
          ).project(c)
          const pixels = at([0, 5.999999999, 6, 6.000000001, 20], sample % 5)
          const pointer = new Vector2(point.x + (2 * pixels) / width, point.y)
          if (f.compare(candidates, { camera: c, pointer, width, height, planes }).length)
            nonempty++
        }
      }
      expect(nonempty).toBeGreaterThan(50)
    } finally {
      f.dispose()
    }
  })

  it("preserves exact six-pixel, endpoint, degenerate, depth, clipped-occluder, and overlap ordering", () => {
    const f = fixture([model("result", 0), model("front", 5)])
    try {
      const candidates = [
        candidate("crossing", [
          [-30, 0, 0],
          [30, 0, 0],
        ]),
        candidate("point", [
          [0, 0, 0],
          [0, 0, 0],
        ]),
        candidate("front", [
          [-8, 0, 6],
          [8, 0, 6],
        ]),
        candidate("near", [
          [-8, 0, 29.95],
          [8, 0, 28],
        ]),
        candidate("far", [
          [-8, 0, -100],
          [8, 0, -60],
        ]),
        ...Array.from({ length: 12 }, (_, index) =>
          candidate(`overlap-${index}`, [
            [-8, 0, 1],
            [8, 0, 1],
          ]),
        ),
      ]
      f.presentation.setCandidates(candidates)
      const c = camera()
      for (const planes of [
        null,
        [new Plane(new Vector3(0, 0, -1), 1)],
        [new Plane(new Vector3(1, 0, 0), 0)],
      ]) {
        for (const x of [-8.6, -8, 0, 8, 8.6]) {
          for (const y of [0, 5.999999999, 6, 6.000000001]) {
            f.compare(candidates, {
              camera: c,
              pointer: new Vector2(x / 20, y / 200),
              width: 400,
              height: 400,
              planes,
            })
          }
        }
      }
      const stack = f.compare(candidates, {
        camera: c,
        pointer: new Vector2(),
        width: 400,
        height: 400,
        planes: [new Plane(new Vector3(0, 0, -1), 1)],
      })
      expect(stack).toHaveLength(8)
      f.presentation.setPreselection(at(stack, 7))
      expect(f.presentation.pick(c, new Vector2(), 400, 400)).toBe(at(stack, 7))
    } finally {
      f.dispose()
    }
  })

  it("retains the unpruned behavior for huge finite coordinates, overflow, unsafe projections and dimensions", () => {
    const f = fixture()
    // Existing highlight buffers overflow Float32 for these accepted finite Float64 samples.
    const errors = spyOn(console, "error").mockImplementation(() => undefined)
    try {
      const candidates = [
        candidate("ordinary", [
          [-8, 0, 0],
          [8, 0, 0],
        ]),
        candidate("large", [
          [-1e100, 0, 0],
          [1e100, 0, 0],
        ]),
        candidate("overflow", [
          [-Number.MAX_VALUE, 0, 0],
          [Number.MAX_VALUE, 0, 0],
        ]),
        candidate("large-point", [
          [1e100, 1e100, 0],
          [1e100, 1e100, 0],
        ]),
        candidate("subnormal", [
          [0, Number.MIN_VALUE, 0],
          [Number.MIN_VALUE, 0, 0],
        ]),
      ]
      f.presentation.setCandidates(candidates)
      const c = camera()
      const queries: Query[] = [
        { camera: c, pointer: new Vector2(), width: 400, height: 400 },
        { camera: c, pointer: new Vector2(1e100, 0), width: 400, height: 400 },
        { camera: c, pointer: new Vector2(), width: 0, height: 400 },
        { camera: c, pointer: new Vector2(), width: 400, height: 0 },
        { camera: c, pointer: new Vector2(), width: Number.MIN_VALUE, height: Number.MIN_VALUE },
        { camera: c, pointer: new Vector2(), width: 1e200, height: 400 },
        { camera: c, pointer: new Vector2(NaN, 0), width: 400, height: 400 },
        {
          camera: c,
          pointer: new Vector2(),
          width: 400,
          height: 400,
          planes: [new Plane(new Vector3(1e300, 0, 0), 1)],
        },
      ]
      for (const query of queries) f.compare(candidates, query)
      c.projectionMatrix.elements[3] = 0.1
      f.compare(candidates, { camera: c, pointer: new Vector2(), width: 400, height: 400 })
      c.zoom = 1e100
      c.updateProjectionMatrix()
      f.compare(candidates, { camera: c, pointer: new Vector2(), width: 400, height: 400 })
      expect(errors).toHaveBeenCalled()
      expect(
        errors.mock.calls.every(
          ([message]) =>
            typeof message === "string" &&
            message.startsWith(
              "THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN.",
            ),
        ),
      ).toBe(true)
    } finally {
      errors.mockRestore()
      f.dispose()
    }
  })

  it("refreshes installed bounds without confusing sibling roles, reused IDs, surfaces or rejected samples", () => {
    const body = model()
    const sibling = model("sibling")
    const f = fixture([body, sibling])
    try {
      const c = camera()
      const query = { camera: c, pointer: new Vector2(), width: 400, height: 400 }
      const a = candidate("shared-id", [
        [-8, 0, 0],
        [8, 0, 0],
      ])
      const b = candidate(
        "shared-id",
        [
          [-8, 0, 1],
          [8, 0, 1],
        ],
        "sibling",
      )
      const rejected = [
        candidate("short", [[0, 0, 0]]),
        candidate("nan", [
          [0, 0, 0],
          [NaN, 0, 0],
        ]),
        candidate("infinity", [
          [0, 0, 0],
          [0, Infinity, 0],
        ]),
      ]
      f.presentation.setCandidates([a, b, a, ...rejected])
      expect(f.compare([a, b], query)).toHaveLength(2)
      body.surface.position.set(1000, 1000, 1000)
      f.compare([a, b], query)
      const moved = {
        ...a,
        points: [
          [-8, 5, 0],
          [8, 5, 0],
        ] as const,
      }
      f.presentation.setCandidates([moved, b])
      expect(f.compare([moved, b], query)).toEqual([b])
      f.presentation.setBodies([{ source: { ...body.source }, surface: body.surface }, sibling])
      f.compare([moved, b], query)
      body.surface.visible = false
      f.presentation.setBodies([body, sibling])
      f.compare([b], query)
      body.surface.visible = true
      f.presentation.setBodies([body, sibling])
      f.compare([b], query)
      const replacement = { ...body.source, positions: new Float32Array([1, 2, 3]) }
      f.presentation.setBodies([{ source: replacement, surface: body.surface }, sibling])
      f.compare([b], query)
      f.presentation.setCandidates([a, b])
      f.compare([a, b], query)
      f.presentation.dispose()
      expect(f.presentation.pick(c, new Vector2(), 400, 400)).toBeNull()
    } finally {
      f.dispose()
    }
  })
})
