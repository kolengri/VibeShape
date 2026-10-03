import { type ImportLimits, requireImport } from "./contracts"

const ENTITIES = new Set([
  "LINE",
  "ARC",
  "CIRCLE",
  "ELLIPSE",
  "LWPOLYLINE",
  "POLYLINE",
  "INSERT",
  "VERTEX",
  "SEQEND",
  "BLOCK",
  "ENDBLK",
])
function geometryConstraints(entity: string, code: number, value: string) {
  if (
    code === 39 ||
    (["LWPOLYLINE", "POLYLINE", "VERTEX"].includes(entity) && [40, 41, 43].includes(code))
  )
    requireImport(
      Number(value) === 0,
      "unsupported-geometry",
      "DXF thickness and wide polylines require an explicit geometry policy.",
      entity,
    )
  if ([210, 220, 230].includes(code))
    requireImport(
      Number(value) === (code === 230 ? 1 : 0),
      "unsupported-geometry",
      "DXF non-default extrusion planes are unsupported.",
      entity,
    )
  if (["POLYLINE:30", "VERTEX:70"].includes(`${entity}:${code}`))
    requireImport(
      Number(value) === 0,
      "unsupported-geometry",
      "DXF fitted, spatial or elevated polylines are unsupported.",
    )
}
function blockConstraints(code: number, value: string) {
  if (code === 70)
    requireImport(
      (Number(value) & 124) === 0,
      "unsafe-reference",
      "External DXF blocks are forbidden.",
    )
  if (code === 1)
    requireImport(value === "", "unsafe-reference", "DXF block external references are forbidden.")
}
export class DxfInventory {
  private section = ""
  private entity = ""
  private expectSection = false
  private ended = false
  private entities = 0
  private segments = 0
  private polyline: { vertices: number; closed: boolean } | undefined
  private lw: { declared?: number; vertices: number; closed: boolean } | undefined
  private readonly blockNames = new Set<string>()
  constructor(private readonly limits: ImportLimits) {}
  private addSegments(count: number) {
    requireImport(count > 0, "invalid-geometry", "DXF polylines require at least one segment.")
    this.segments += count
    requireImport(
      this.segments <= this.limits.pathSegments,
      "resource-limit",
      "DXF source geometry exceeds its analytical segment budget.",
    )
  }
  private finishLw() {
    if (!this.lw) return
    requireImport(
      this.lw.declared !== undefined && this.lw.declared === this.lw.vertices,
      "invalid-format",
      "DXF LWPOLYLINE vertex count is inconsistent.",
    )
    this.addSegments(this.lw.vertices - (this.lw.closed ? 0 : 1))
    this.lw = undefined
  }
  private record(value: string) {
    requireImport(ENTITIES.has(value), "unsupported-geometry", "Unsupported DXF entity.", value)
    this.entity = value
    requireImport(
      ++this.entities <= this.limits.pathSegments * 4 + this.limits.bodies * 2,
      "resource-limit",
      "DXF exceeds its entity budget.",
    )
    if (["LINE", "CIRCLE", "ARC", "ELLIPSE"].includes(value)) this.addSegments(1)
    if (value === "LWPOLYLINE") this.lw = { vertices: 0, closed: false }
    if (value === "POLYLINE") this.polyline = { vertices: 0, closed: false }
    if (value === "VERTEX" || value === "SEQEND") this.polylineRecord(value)
  }
  private polylineRecord(value: string) {
    requireImport(
      this.polyline !== undefined,
      "invalid-format",
      "DXF VERTEX/SEQEND occurs outside a POLYLINE.",
    )
    if (value === "VERTEX") {
      this.polyline.vertices++
      requireImport(
        this.polyline.vertices <= this.limits.pathSegments + 1,
        "resource-limit",
        "DXF POLYLINE exceeds its vertex budget.",
      )
      return
    }
    this.addSegments(this.polyline.vertices - (this.polyline.closed ? 0 : 1))
    this.polyline = undefined
  }
  private boundary(value: string) {
    this.finishLw()
    if (this.polyline)
      requireImport(
        value === "VERTEX" || value === "SEQEND",
        "invalid-format",
        "DXF POLYLINE requires a complete VERTEX/SEQEND sequence.",
      )
    if (value === "SECTION") {
      requireImport(!this.section, "invalid-format", "Nested DXF sections are invalid.")
      this.expectSection = true
      return
    }
    if (value === "ENDSEC") {
      requireImport(Boolean(this.section), "invalid-format", "DXF ENDSEC has no section.")
      this.section = ""
      this.entity = ""
      return
    }
    if (value === "EOF") {
      requireImport(!this.section, "invalid-format", "DXF EOF occurs before ENDSEC.")
      this.ended = true
      return
    }
    if (this.geometrySection()) this.record(value)
  }
  private geometrySection() {
    return this.section === "ENTITIES" || this.section === "BLOCKS"
  }
  private polylineAttribute(code: number, value: string) {
    if (this.lw) {
      if (code === 90) {
        requireImport(
          Number(value) >= 2 && Number(value) <= this.limits.pathSegments + 1,
          "resource-limit",
          "DXF LWPOLYLINE exceeds its declared vertex budget.",
        )
        this.lw.declared = Number(value)
      }
      if (code === 10) this.lw.vertices++
      if (code === 70) this.lw.closed = (Number(value) & 1) !== 0
    }
    if (this.entity === "POLYLINE" && code === 70 && this.polyline)
      this.polyline.closed = (Number(value) & 1) !== 0
  }
  private blockAttribute(code: number, value: string) {
    blockConstraints(code, value)
    if (code !== 2) return
    requireImport(
      !this.blockNames.has(value),
      "invalid-format",
      "DXF block names must be unique.",
      value,
    )
    this.blockNames.add(value)
    requireImport(
      this.blockNames.size <= this.limits.bodies,
      "resource-limit",
      "DXF exceeds its block budget.",
    )
  }
  group(code: number, value: string) {
    requireImport(!this.ended, "invalid-format", "DXF has data after EOF.")
    if (this.expectSection) {
      requireImport(code === 2, "invalid-format", "DXF SECTION requires its name.")
      this.section = value
      this.expectSection = false
      return
    }
    if (code === 0) this.boundary(value)
    if (!this.geometrySection()) return
    this.polylineAttribute(code, value)
    geometryConstraints(this.entity, code, value)
    if (this.entity === "BLOCK") this.blockAttribute(code, value)
  }
  finish() {
    requireImport(
      this.ended && !this.expectSection,
      "invalid-format",
      "DXF is missing a complete EOF record.",
    )
  }
}
