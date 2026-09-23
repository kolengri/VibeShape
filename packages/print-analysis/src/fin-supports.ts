import type {
  PrintPreparationMesh,
  PrintPreparationSettings,
  PrintPreparationWarning,
} from "@vibeshape/protocol"
import {
  convexFacets,
  cross2,
  dot,
  EPS,
  type Facet,
  type Point,
  type Point2,
} from "./mesh-geometry"
import { extrudeProfile } from "./profile-mesh"

function insideFacet(point: Point, facet: Facet) {
  const axis = facet.normal.findIndex(
    (n) => Math.abs(n) === Math.max(...facet.normal.map(Math.abs)),
  )
  const project = (p: Point): Point2 =>
    axis === 0 ? [p[1], p[2]] : axis === 1 ? [p[0], p[2]] : [p[0], p[1]]
  const [a, b, c] = facet.points.map(project) as [Point2, Point2, Point2]
  const p = project(point)
  const sign = Math.sign(cross2(a, b, c))
  return [cross2(a, b, p), cross2(b, c, p), cross2(c, a, p)].every((value) => value * sign > EPS)
}

function contactLayers(
  facet: Facet,
  facets: Facet[],
  settings: PrintPreparationSettings,
  u: Point,
  vCenter: number,
  faceU: (z: number) => number,
) {
  const v: Point = [-u[1], u[0], 0]
  const maxZ = Math.max(...facet.points.map((p) => p[2]))
  const minZ = Math.min(...facet.points.map((p) => p[2]))
  const step = Math.max(2, Math.ceil(settings.spacing / settings.layerHeight))
  const start = Math.max(1, Math.ceil(minZ / settings.layerHeight))
  const end = Math.floor(maxZ / settings.layerHeight) - 1
  if (Math.ceil((end - start) / step) > 64) return []
  const contacts: number[] = []
  for (let layer = start; layer <= end; layer += step) {
    const z0 = layer * settings.layerHeight
    const z1 = z0 + settings.layerHeight
    const tip = faceU(z0) - 0.1
    const safe = [z0, z1].every((z) =>
      [vCenter - settings.thickness / 2, vCenter + settings.thickness / 2].every((side) => {
        const surface: Point = [u[0] * faceU(z) + v[0] * side, u[1] * faceU(z) + v[1] * side, z]
        const contact: Point = [u[0] * tip + v[0] * side, u[1] * tip + v[1] * side, z]
        return (
          insideFacet(surface, facet) &&
          facets.every((f) => dot(f.normal, contact) <= f.plane + EPS)
        )
      }),
    )
    if (safe) contacts.push(z0)
  }
  return contacts
}

function makeFin(facet: Facet, facets: Facet[], settings: PrintPreparationSettings, index: number) {
  const horizontal = Math.hypot(facet.normal[0], facet.normal[1])
  const u: Point = [facet.normal[0] / horizontal, facet.normal[1] / horizontal, 0]
  const v: Point = [-u[1], u[0], 0]
  const vCenter = facet.points.reduce((sum, p) => sum + dot(v, p), 0) / 3
  const faceU = (z: number) => (facet.plane - facet.normal[2] * z) / horizontal
  const contacts = contactLayers(facet, facets, settings, u, vCenter, faceU)
  const lastContact = contacts.at(-1)
  if (lastContact === undefined) return null
  const top = lastContact + settings.layerHeight * 2
  const outer = faceU(top) + settings.clearance + settings.reach
  const polygon: Point2[] = [
    [outer, 0],
    [outer, top],
    [faceU(top) + settings.clearance, top],
  ]
  for (const z0 of [...contacts].reverse()) {
    const z1 = z0 + settings.layerHeight
    const tip = faceU(z0) - 0.1
    polygon.push(
      [faceU(z1) + settings.clearance, z1],
      [tip, z1],
      [tip, z0],
      [faceU(z0) + settings.clearance, z0],
    )
  }
  polygon.push([faceU(0) + settings.clearance, 0])
  return {
    mesh: extrudeProfile(`Breakaway fin ${index + 1}`, polygon, u, vCenter, settings.thickness),
    contacts: contacts.length,
  }
}

function coverageWarning(finCount: number, candidateCount: number): PrintPreparationWarning {
  if (finCount > 0) return "partial-coverage"
  return candidateCount === 0 ? "no-suitable-facet" : "no-safe-contacts"
}

function selectFins(facets: Facet[], settings: PrintPreparationSettings) {
  const output: PrintPreparationMesh[] = []
  const warnings: PrintPreparationWarning[] = []
  const candidates = facets
    .filter((f) => f.normal[2] < -0.2 && f.normal[2] > -0.98)
    .sort((a, b) => b.area - a.area)
  let contacts = 0
  let selected: Facet | null = null
  const transverseSites: number[] = []
  for (const facet of candidates.slice(0, 24)) {
    // Coplanar fins occupy disjoint transverse slabs; no generic inter-fin collision is inferred safe.
    if (
      selected &&
      (dot(selected.normal, facet.normal) < 1 - EPS || Math.abs(selected.plane - facet.plane) > EPS)
    )
      continue
    const horizontal = Math.hypot(facet.normal[0], facet.normal[1])
    const transverse: Point = [-facet.normal[1] / horizontal, facet.normal[0] / horizontal, 0]
    const site = facet.points.reduce((sum, p) => sum + dot(transverse, p), 0) / 3
    if (
      transverseSites.some(
        (prior) => Math.abs(prior - site) <= settings.thickness + settings.clearance,
      )
    )
      continue
    const fin = makeFin(facet, facets, settings, output.length)
    if (!fin) continue
    output.push(fin.mesh)
    contacts += fin.contacts
    selected = facet
    transverseSites.push(site)
    if (output.length === 2) break
  }
  warnings.push(coverageWarning(output.length, candidates.length))
  return { meshes: output, contacts, warnings }
}

export function generateFins(meshes: PrintPreparationMesh[], settings: PrintPreparationSettings) {
  const empty = { meshes: [] as PrintPreparationMesh[], contacts: 0 }
  if (!settings.supports) return { ...empty, warnings: [] }
  const [body] = meshes
  if (meshes.length !== 1 || !body) return { ...empty, warnings: ["multiple-bodies" as const] }
  const facets = convexFacets(body)
  if (facets === "complexity-limit" || facets === "nonconvex-or-open")
    return { ...empty, warnings: [facets] }
  return selectFins(facets, settings)
}
