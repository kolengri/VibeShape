import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three"
import { sectionCapPositions } from "./section-cap"
import { sameViewerSection, type ViewerSection } from "./section-view"
import type { ViewerMesh } from "./three-viewport"
import { viewerBodyColor } from "./viewer-appearance"

export function sectionDragDirection(
  axis: ViewerSection["axis"],
  camera: OrthographicCamera,
  width: number,
  height: number,
) {
  const origin = new Vector3().project(camera)
  const unit = new Vector3().setComponent({ x: 0, y: 1, z: 2 }[axis], 1).project(camera)
  const projected = new Vector2(
    ((unit.x - origin.x) * width) / 2,
    (-(unit.y - origin.y) * height) / 2,
  )
  const worldPerPixel = (camera.top - camera.bottom) / (camera.zoom * Math.max(height, 1))
  // A normal-facing plane has no projected normal. Vertical drag remains finite and predictable.
  if (projected.length() * worldPerPixel < 0.15) return new Vector2(0, -worldPerPixel)
  return projected.multiplyScalar(1 / projected.lengthSq())
}

type SectionDrag = Readonly<{
  pointerId: number
  x: number
  y: number
  section: ViewerSection
  direction: Vector2
  navigationEnabled: boolean
}>
type SectionDecorationOptions = Readonly<{
  canvas: HTMLCanvasElement
  camera: OrthographicCamera
  canInteract: () => boolean
  navigationEnabled: () => boolean
  setNavigationEnabled: (enabled: boolean) => void
  onChange: (section: ViewerSection) => void
  render: () => void
}>

export class SectionViewDecoration {
  readonly group = new Group()
  readonly #caps = new Group()
  readonly #planeMaterial = new MeshBasicMaterial({
    color: "#ebaa53",
    transparent: true,
    opacity: 0.045,
    depthWrite: false,
    side: DoubleSide,
  })
  readonly #lineMaterial = new LineBasicMaterial({
    color: "#d58b2b",
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  })
  readonly #handleMaterial = new MeshBasicMaterial({
    color: "#e99b36",
    depthTest: false,
    depthWrite: false,
  })
  readonly #plane = new Mesh(new BufferGeometry(), this.#planeMaterial)
  readonly #outline = new LineSegments(new BufferGeometry(), this.#lineMaterial)
  readonly #stemMaterial = new LineBasicMaterial({
    color: "#e99b36",
    depthTest: false,
    depthWrite: false,
  })
  readonly #stem = new LineSegments(new BufferGeometry(), this.#stemMaterial)
  readonly #handle = new Mesh(new SphereGeometry(1, 16, 10), this.#handleMaterial)
  readonly #options: SectionDecorationOptions
  readonly #bounds = new Box3()
  #section: ViewerSection | null = null
  #meshes: readonly ViewerMesh[] = []
  #drag: SectionDrag | null = null
  #pendingOffset: number | null = null
  #frame: number | null = null

  constructor(options: SectionDecorationOptions) {
    this.#options = options
    this.#handle.renderOrder = this.#stem.renderOrder = 1000
    this.group.add(this.#caps, this.#plane, this.#outline, this.#stem, this.#handle)
    this.group.visible = false
    const canvas = options.canvas
    canvas.addEventListener("pointerdown", this.#pointerDown, true)
    canvas.addEventListener("pointermove", this.#pointerMove, true)
    canvas.addEventListener("pointerup", this.#pointerUp, true)
    canvas.addEventListener("pointercancel", this.#cancelPointer, true)
    canvas.addEventListener("lostpointercapture", this.#cancelPointer, true)
    window.addEventListener("blur", this.#cancel)
    window.addEventListener("keydown", this.#keyDown, true)
  }

  setMeshes(meshes: readonly ViewerMesh[]) {
    this.#meshes = meshes.filter(
      (mesh) => mesh.appearance !== "datum" && mesh.appearance !== "selection-source",
    )
    this.#bounds.makeEmpty()
    for (const mesh of this.#meshes) {
      for (let index = 0; index < mesh.positions.length; index += 3)
        this.#bounds.expandByPoint(new Vector3().fromArray(mesh.positions, index))
    }
    this.#rebuild()
  }

  setSection(section: ViewerSection | null) {
    if (
      this.#drag &&
      (!section ||
        section.axis !== this.#drag.section.axis ||
        section.flipped !== this.#drag.section.flipped)
    )
      this.#finish(false)
    if (sameViewerSection(this.#section, section)) return
    this.#section = section
    this.#rebuild()
  }

  #clearCaps() {
    for (const child of [...this.#caps.children]) {
      if (child instanceof Mesh) {
        child.geometry.dispose()
        child.material.dispose()
      }
      this.#caps.remove(child)
    }
  }

  #rebuild() {
    this.#clearCaps()
    this.group.visible = this.#section !== null && !this.#bounds.isEmpty()
    if (!this.#section || !this.group.visible) return
    for (const source of this.#meshes) {
      const positions = sectionCapPositions(source, this.#section)
      if (!positions) continue
      const geometry = new BufferGeometry().setAttribute(
        "position",
        new BufferAttribute(positions, 3),
      )
      const material = new MeshBasicMaterial({
        color:
          source.appearance === "preview"
            ? "#e4b064"
            : (viewerBodyColor(source.featureId) ?? "#9aaec1"),
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
      const cap = new Mesh(geometry, material)
      cap.name = `section-cap:${source.featureId}:${source.outputRole ?? "result"}`
      this.#caps.add(cap)
    }
    this.update()
  }

  update() {
    const { canvas, camera } = this.#options
    if (!this.group.visible || !this.#section) {
      delete canvas.dataset.sectionGizmoHandle
      delete canvas.dataset.sectionOffset
      delete canvas.dataset.sectionCapCount
      return
    }
    const axis = { x: 0, y: 1, z: 2 }[this.#section.axis]
    const [u = 0, v = 1] = [0, 1, 2].filter((value) => value !== axis)
    const worldPerPixel =
      (camera.top - camera.bottom) / (camera.zoom * Math.max(canvas.clientHeight, 1))
    const padding = worldPerPixel * 18
    const center = this.#bounds.getCenter(new Vector3()).setComponent(axis, this.#section.offset)
    const size = this.#bounds.getSize(new Vector3())
    const extentU = Math.max(size.getComponent(u) / 2 + padding, worldPerPixel * 30)
    const extentV = Math.max(size.getComponent(v) / 2 + padding, worldPerPixel * 30)
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a = 0, b = 0]) =>
      center
        .clone()
        .setComponent(u, center.getComponent(u) + a * extentU)
        .setComponent(v, center.getComponent(v) + b * extentV),
    )
    const triangles = [0, 1, 2, 0, 2, 3].flatMap((index) => corners[index]?.toArray() ?? [])
    this.#plane.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(triangles), 3),
    )
    const edges = corners.flatMap((point, index) => [
      ...point.toArray(),
      ...(corners[(index + 1) % 4]?.toArray() ?? []),
    ])
    this.#outline.geometry.setAttribute("position", new BufferAttribute(new Float32Array(edges), 3))
    const anchor = corners[2] ?? center
    this.#handle.position.copy(anchor).setComponent(axis, this.#section.offset + worldPerPixel * 30)
    this.#handle.scale.setScalar(worldPerPixel * 7)
    this.#stem.geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([...anchor.toArray(), ...this.#handle.position.toArray()]),
        3,
      ),
    )
    // Bounds change when the section moves; refresh culling and camera-depth bounds.
    for (const geometry of [this.#plane.geometry, this.#outline.geometry, this.#stem.geometry]) {
      geometry.computeBoundingSphere()
      geometry.computeBoundingBox()
    }
    const projected = this.#handle.position.clone().project(camera)
    canvas.dataset.sectionGizmoHandle = `${((projected.x + 1) * canvas.clientWidth) / 2},${((1 - projected.y) * canvas.clientHeight) / 2}`
    canvas.dataset.sectionOffset = String(this.#section.offset)
    canvas.dataset.sectionCapCount = String(this.#caps.children.length)
  }

  #hitsHandle(event: PointerEvent) {
    if (!this.#section || !this.group.visible || !this.#options.canInteract()) return false
    const { canvas, camera } = this.#options
    const projected = this.#handle.position.clone().project(camera)
    const rect = canvas.getBoundingClientRect()
    return (
      Math.hypot(
        event.clientX - rect.left - ((projected.x + 1) * rect.width) / 2,
        event.clientY - rect.top - ((1 - projected.y) * rect.height) / 2,
      ) <= 14
    )
  }

  #pointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || !this.#section || !this.#hitsHandle(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const { canvas, camera } = this.#options
    this.#drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      section: this.#section,
      direction: sectionDragDirection(
        this.#section.axis,
        camera,
        canvas.clientWidth,
        canvas.clientHeight,
      ),
      navigationEnabled: this.#options.navigationEnabled(),
    }
    this.#options.setNavigationEnabled(false)
    canvas.style.cursor = "grabbing"
    canvas.dataset.sectionDragging = "true"
    canvas.setPointerCapture(event.pointerId)
  }

  #pointerMove = (event: PointerEvent) => {
    const drag = this.#drag
    if (!drag) {
      if (!event.buttons && this.#hitsHandle(event)) {
        this.#options.canvas.style.cursor = "grab"
        event.stopImmediatePropagation()
      } else if (this.#options.canvas.style.cursor === "grab")
        this.#options.canvas.style.cursor = ""
      return
    }
    if (event.pointerId !== drag.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#pendingOffset = Math.max(
      -100_000,
      Math.min(
        100_000,
        drag.section.offset +
          (event.clientX - drag.x) * drag.direction.x +
          (event.clientY - drag.y) * drag.direction.y,
      ),
    )
    if (this.#frame === null) this.#frame = requestAnimationFrame(this.#flush)
  }

  #flush = () => {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame)
    this.#frame = null
    const offset = this.#pendingOffset
    this.#pendingOffset = null
    if (offset !== null && this.#section && this.#drag)
      this.#options.onChange({ ...this.#section, offset })
  }

  #pointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.#drag?.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#flush()
    this.#finish(false)
  }
  #cancelPointer = (event: PointerEvent) => {
    if (event.pointerId === this.#drag?.pointerId) this.#finish(true)
  }
  #cancel = () => this.#finish(true)
  #keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.#drag) {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.#finish(true)
    }
  }

  #finish(restore: boolean) {
    const drag = this.#drag
    if (!drag) return
    this.#drag = null
    if (this.#frame !== null) cancelAnimationFrame(this.#frame)
    this.#frame = null
    this.#pendingOffset = null
    this.#options.setNavigationEnabled(drag.navigationEnabled)
    const canvas = this.#options.canvas
    delete canvas.dataset.sectionDragging
    canvas.style.cursor = ""
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId)
    if (restore) this.#options.onChange(drag.section)
    this.#options.render()
  }

  dispose() {
    this.#finish(false)
    const canvas = this.#options.canvas
    canvas.removeEventListener("pointerdown", this.#pointerDown, true)
    canvas.removeEventListener("pointermove", this.#pointerMove, true)
    canvas.removeEventListener("pointerup", this.#pointerUp, true)
    canvas.removeEventListener("pointercancel", this.#cancelPointer, true)
    canvas.removeEventListener("lostpointercapture", this.#cancelPointer, true)
    window.removeEventListener("blur", this.#cancel)
    window.removeEventListener("keydown", this.#keyDown, true)
    delete canvas.dataset.sectionGizmoHandle
    delete canvas.dataset.sectionOffset
    delete canvas.dataset.sectionCapCount
    this.#clearCaps()
    for (const object of [this.#plane, this.#outline, this.#stem, this.#handle])
      object.geometry.dispose()
    this.#planeMaterial.dispose()
    this.#lineMaterial.dispose()
    this.#handleMaterial.dispose()
    this.#stemMaterial.dispose()
    this.group.clear()
  }
}
