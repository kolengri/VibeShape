import {
  ArrowHelper,
  type BufferGeometry,
  DoubleSide,
  Group,
  Line,
  Mesh,
  MeshBasicMaterial,
  type Plane,
  Vector3,
} from "three"
import type { ViewerMesh, ViewerVector3 } from "./three-viewport"
import { viewerSemanticColor } from "./viewer-semantic-color"

export type ViewerAnalysisOverlay =
  | Readonly<{
      kind: "face"
      mesh: ViewerMesh
      faceIds: readonly number[]
      role: "support" | "load" | "preserve"
    }>
  | Readonly<{
      kind: "force-arrow"
      origin: ViewerVector3
      vector: ViewerVector3
      /** Display length in viewport units, independent of force magnitude. */
      length: number
    }>

const roleTokens = {
  support: "--preselection",
  load: "--diagnostic-warning",
  preserve: "--sketch-reference-context",
} as const

/** Disposable presentation over an explicitly captured mesh, never a topology authority. */
export class AnalysisOverlayDecoration {
  readonly group = new Group()
  readonly #faceGeometry: (mesh: ViewerMesh, faceId: number) => BufferGeometry | null
  readonly #faceRoles = new Map<Mesh, keyof typeof roleTokens>()
  #themeObserver: MutationObserver | null = null
  #disposed = false

  constructor(
    faceGeometry: (mesh: ViewerMesh, faceId: number) => BufferGeometry | null,
    onThemeChange: () => void = () => {},
  ) {
    this.#faceGeometry = faceGeometry
    this.group.name = "analysis-overlays"
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return
    this.#themeObserver = new MutationObserver(() => {
      this.refreshColors()
      onThemeChange()
    })
    this.#themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    })
  }

  setOverlays(overlays: readonly ViewerAnalysisOverlay[] | null) {
    if (this.#disposed) return
    this.clear()
    for (const overlay of overlays ?? []) {
      if (overlay.kind === "face") this.addFaces(overlay)
      else this.addArrow(overlay)
    }
    this.group.traverse((object) => {
      object.raycast = () => {}
    })
  }

  setClipping(planes: Plane[] | null) {
    this.group.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof Line)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (material.clippingPlanes === planes) continue
        material.clippingPlanes = planes
        material.needsUpdate = true
      }
    })
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#themeObserver?.disconnect()
    this.clear()
  }

  private addFaces(overlay: Extract<ViewerAnalysisOverlay, { kind: "face" }>) {
    for (const faceId of new Set(overlay.faceIds)) {
      if (!Number.isInteger(faceId) || faceId < 0) continue
      const geometry = this.#faceGeometry(overlay.mesh, faceId)
      if (!geometry) continue
      const surface = new Mesh(
        geometry,
        new MeshBasicMaterial({
          color: viewerSemanticColor(roleTokens[overlay.role]),
          opacity: 0.48,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          side: DoubleSide,
        }),
      )
      surface.name = `analysis-${overlay.role}:${faceId}`
      this.#faceRoles.set(surface, overlay.role)
      surface.renderOrder = 5
      this.group.add(surface)
    }
  }

  private addArrow(overlay: Extract<ViewerAnalysisOverlay, { kind: "force-arrow" }>) {
    if (
      ![...overlay.origin, ...overlay.vector].every(Number.isFinite) ||
      !Number.isFinite(overlay.length) ||
      overlay.length <= 0
    )
      return
    const magnitude = Math.hypot(...overlay.vector)
    if (!Number.isFinite(magnitude) || magnitude === 0) return
    const direction = new Vector3(
      overlay.vector[0] / magnitude,
      overlay.vector[1] / magnitude,
      overlay.vector[2] / magnitude,
    )
    const arrow = new ArrowHelper(
      direction,
      new Vector3(...overlay.origin),
      overlay.length,
      viewerSemanticColor(roleTokens.load),
      overlay.length * 0.22,
      overlay.length * 0.12,
    )
    // ArrowHelper shares primitive geometry; this decoration owns only its clones.
    arrow.line.geometry = arrow.line.geometry.clone()
    arrow.cone.geometry = arrow.cone.geometry.clone()
    arrow.name = "analysis-force-arrow"
    for (const object of [arrow.line, arrow.cone]) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.depthWrite = false
    }
    arrow.line.renderOrder = 6
    arrow.cone.renderOrder = 6
    this.group.add(arrow)
  }

  private refreshColors() {
    for (const object of this.group.children) {
      if (object instanceof ArrowHelper) object.setColor(viewerSemanticColor(roleTokens.load))
      else if (object instanceof Mesh && object.material instanceof MeshBasicMaterial) {
        const role = this.#faceRoles.get(object)
        if (role) object.material.color.copy(viewerSemanticColor(roleTokens[role]))
      }
    }
  }

  private clear() {
    this.group.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof Line)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    })
    this.group.clear()
    this.#faceRoles.clear()
  }
}
