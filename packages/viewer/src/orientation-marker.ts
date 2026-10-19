import {
  AxesHelper,
  BufferGeometry,
  type Camera,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Plane,
  type Quaternion,
  Raycaster,
  RingGeometry,
  Shape,
  ShapeGeometry,
  type Vector2,
  Vector3,
} from "three"

export type OrientationMarkerAxis = "X" | "-X" | "Y" | "-Y" | "Z" | "-Z"

const AXIS_LENGTH = 0.62
const axes = [
  { label: "X", color: "#e15b64", position: [AXIS_LENGTH, 0, 0] },
  { label: "Y", color: "#35a66f", position: [0, AXIS_LENGTH, 0] },
  { label: "Z", color: "#4c8dff", position: [0, 0, AXIS_LENGTH] },
] as const

const glyphOutlines = {
  X: [
    [-0.08, -0.12],
    [-0.03, -0.12],
    [0, -0.045],
    [0.03, -0.12],
    [0.08, -0.12],
    [0.03, 0],
    [0.08, 0.12],
    [0.03, 0.12],
    [0, 0.045],
    [-0.03, 0.12],
    [-0.08, 0.12],
    [-0.03, 0],
  ],
  Y: [
    [-0.085, 0.12],
    [-0.03, 0.12],
    [0, 0.045],
    [0.03, 0.12],
    [0.085, 0.12],
    [0.025, -0.015],
    [0.025, -0.12],
    [-0.025, -0.12],
    [-0.025, -0.015],
  ],
  Z: [
    [-0.08, 0.12],
    [0.08, 0.12],
    [0.08, 0.075],
    [-0.02, -0.07],
    [0.08, -0.07],
    [0.08, -0.12],
    [-0.08, -0.12],
    [-0.08, -0.075],
    [0.02, 0.07],
    [-0.08, 0.07],
  ],
} as const

function glyphGeometry(label: keyof typeof glyphOutlines) {
  const shape = new Shape()
  glyphOutlines[label].forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  })
  shape.closePath()
  return new ShapeGeometry(shape)
}

/** Camera-facing endpoint labels with viewport-owned, reusable GPU resources. */
export class OrientationMarker {
  readonly group = new Group()
  readonly #labels: Group[] = []
  readonly #axisTargets = new Map<Object3D, OrientationMarkerAxis>()
  readonly #raycaster = new Raycaster()
  readonly #geometries = new Set<BufferGeometry>()
  readonly #materials = new Set<Material>()
  #disposed = false

  constructor() {
    const positiveAxes = new AxesHelper(AXIS_LENGTH)
    positiveAxes.setColors(
      new Color(axes[0].color),
      new Color(axes[1].color),
      new Color(axes[2].color),
    )
    this.group.add(positiveAxes)

    const negativeAxes = new BufferGeometry()
    negativeAxes.setAttribute(
      "position",
      new Float32BufferAttribute(
        axes.flatMap(({ position }) => [0, 0, 0, ...position.map((value) => -value)]),
        3,
      ),
    )
    negativeAxes.setAttribute(
      "color",
      new Float32BufferAttribute(
        axes.flatMap(({ color }) => {
          const rgb = new Color(color).toArray()
          return [...rgb, ...rgb]
        }),
        3,
      ),
    )
    this.group.add(
      new LineSegments(
        negativeAxes,
        new LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.4,
          toneMapped: false,
        }),
      ),
    )

    const outline = new CircleGeometry(0.215, 32)
    const disc = new CircleGeometry(0.195, 32)
    const negativeRing = new RingGeometry(0.065, 0.085, 24)
    const ink = new MeshBasicMaterial({ color: 0x101820, toneMapped: false })
    for (const { label, color, position } of axes) {
      const axisMaterial = new MeshBasicMaterial({ color, toneMapped: false })
      const positive = new Group()
      positive.name = label
      positive.position.set(position[0], position[1], position[2])
      positive.add(new Mesh(outline, ink))
      const face = new Mesh(disc, axisMaterial)
      face.position.z = 0.002
      const glyph = new Mesh(glyphGeometry(label), ink)
      glyph.position.z = 0.004
      positive.add(face, glyph)

      const negative = new Group()
      negative.name = `-${label}`
      negative.position.copy(positive.position).negate()
      negative.add(new Mesh(negativeRing, axisMaterial))
      this.#axisTargets.set(positive, label)
      this.#axisTargets.set(negative, `-${label}`)
      this.#labels.push(positive, negative)
      this.group.add(positive, negative)
    }
    this.group.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof LineSegments)) return
      this.#geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        this.#materials.add(material)
      }
    })
  }

  alignLabels(cameraOrientation: Quaternion) {
    for (const label of this.#labels) label.quaternion.copy(cameraOrientation)
  }

  axisAt(point: Vector2, camera: Camera): OrientationMarkerAxis | null {
    if (this.#disposed) return null
    this.group.updateMatrixWorld(true)
    this.#raycaster.setFromCamera(point, camera)
    const normal = camera.getWorldDirection(new Vector3())
    const plane = new Plane()
    const intersection = new Vector3()
    let closest = Number.POSITIVE_INFINITY
    let axis: OrientationMarkerAxis | null = null
    for (const label of this.#labels) {
      const center = label.getWorldPosition(new Vector3())
      plane.setFromNormalAndCoplanarPoint(normal, center)
      if (!this.#raycaster.ray.intersectPlane(plane, intersection)) continue
      const candidate = this.#axisTargets.get(label)
      const radius = candidate?.startsWith("-") ? 0.085 : 0.215
      const distance = this.#raycaster.ray.origin.distanceToSquared(intersection)
      if (intersection.distanceToSquared(center) <= radius * radius && distance < closest) {
        closest = distance
        axis = candidate ?? null
      }
    }
    return axis
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const geometry of this.#geometries) geometry.dispose()
    for (const material of this.#materials) material.dispose()
  }
}
