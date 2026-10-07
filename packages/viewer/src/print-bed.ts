import {
  BoxGeometry,
  BufferGeometry,
  type Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from "three"
import { viewerSemanticColor } from "./viewer-semantic-color"

export type ViewerPrintBed = Readonly<{
  width: number
  depth: number
  height: number
  margin: number
  exceeded?: boolean
}>

/** Presentation only: the build envelope never participates in picking or export. */
export class PrintBedDecoration {
  readonly bed = new Group()
  readonly ground = new Group()
  #exceeded = false
  #themeObserver: MutationObserver | null = null

  constructor(onThemeChange: () => void = () => {}) {
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

  private refreshColors() {
    const bed = viewerSemanticColor(this.#exceeded ? "--diagnostic-error" : "--axis-z")
    recolor(this.bed, bed)
    recolor(this.ground, viewerSemanticColor("--axis-z"))
  }

  setBed(volume: ViewerPrintBed | null) {
    this.clear(this.bed)
    if (!volume) return
    const { width, depth, height, margin } = volume
    if (
      ![width, depth, height].every((n) => Number.isFinite(n) && n > 0 && n <= 100_000) ||
      !Number.isFinite(margin) ||
      margin < 0 ||
      2 * margin >= Math.min(width, depth)
    ) {
      throw new Error("Invalid viewer print envelope.")
    }
    this.#exceeded = volume.exceeded ?? false
    const color = viewerSemanticColor(this.#exceeded ? "--diagnostic-error" : "--axis-z")
    const surface = new Mesh(
      new PlaneGeometry(width, depth),
      new MeshBasicMaterial({
        color,
        opacity: 0.12,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    )
    surface.position.z = -0.01
    surface.name = "print-bed"
    this.bed.add(surface)
    const box = new BoxGeometry(width, depth, height)
    const edges = new LineSegments(
      new EdgesGeometry(box),
      new LineBasicMaterial({
        color,
        opacity: 0.4,
        transparent: true,
        depthWrite: false,
      }),
    )
    box.dispose()
    edges.position.z = height / 2
    edges.name = "print-volume"
    this.bed.add(edges)
    this.addGrid(this.bed, width, depth, color, 0.25)
    if (margin > 0) {
      const points = [
        [-width / 2 + margin, -depth / 2 + margin],
        [width / 2 - margin, -depth / 2 + margin],
        [width / 2 - margin, depth / 2 - margin],
        [-width / 2 + margin, depth / 2 - margin],
      ]
      const vertices = points.flatMap((p, i) => {
        const next = points[(i + 1) % 4]
        return next ? [...p, 0.01, ...next, 0.01] : []
      })
      this.addLines(this.bed, vertices, color, 0.8, "print-usable-area")
    }
  }

  setGround(enabled: boolean, size = 300) {
    this.clear(this.ground)
    if (enabled) this.addGrid(this.ground, size, size, viewerSemanticColor("--axis-z"), 0.2)
  }

  dispose() {
    this.#themeObserver?.disconnect()
    this.clear(this.bed)
    this.clear(this.ground)
  }

  private addGrid(group: Group, width: number, depth: number, color: Color, opacity: number) {
    const target = Math.max(width, depth) / 20
    const magnitude = 10 ** Math.floor(Math.log10(target))
    const step = ([1, 2, 5, 10].find((n) => n * magnitude >= target) ?? 10) * magnitude
    const vertices: number[] = []
    for (let x = Math.ceil(-width / 2 / step) * step; x <= width / 2; x += step) {
      vertices.push(x, -depth / 2, 0, x, depth / 2, 0)
    }
    for (let y = Math.ceil(-depth / 2 / step) * step; y <= depth / 2; y += step) {
      vertices.push(-width / 2, y, 0, width / 2, y, 0)
    }
    this.addLines(group, vertices, color, opacity, "ground-grid")
  }

  private addLines(group: Group, vertices: number[], color: Color, opacity: number, name: string) {
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3))
    const lines = new LineSegments(
      geometry,
      new LineBasicMaterial({
        color,
        opacity,
        transparent: true,
        depthWrite: false,
      }),
    )
    lines.name = name
    group.add(lines)
  }

  private clear(group: Group) {
    for (const child of [...group.children]) {
      group.remove(child)
      if (child instanceof Mesh || child instanceof LineSegments) {
        child.geometry.dispose()
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const material of materials) material.dispose()
      }
    }
  }
}

function recolor(group: Group, color: Color) {
  for (const child of group.children) {
    if (!(child instanceof Mesh || child instanceof LineSegments)) continue
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (material instanceof MeshBasicMaterial || material instanceof LineBasicMaterial)
        material.color.copy(color)
    }
  }
}
