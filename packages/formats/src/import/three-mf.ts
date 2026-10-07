import { readSafeZip } from "../safe-zip"
import { THREE_MF_CORE_NAMESPACE, threeMfModelMeshSchema } from "../three-mf"
import { identityTransform, multiplyTransforms, scaledPoint3, validateTransform } from "./affine"
import {
  type ImportedMesh,
  type ImportedMeshNode,
  type ImportLimits,
  importLabel,
  type ParsedGeometryImport,
  requireImport,
} from "./contracts"
import {
  type ImportXmlGeometryBudget,
  type ImportXmlNode,
  parseImportXml,
  xmlChild,
  xmlChildren,
  xmlNumber,
} from "./xml"

const MODEL_RELATIONSHIP = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"
const RELATIONSHIP_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"
const UNIT_MM: Readonly<Record<string, number>> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
}
function canonicalPartPath(target: string | undefined) {
  requireImport(
    Boolean(target) && !/[\\%?#:]/.test(target ?? "") && !target?.includes("\0"),
    "unsafe-reference",
    "3MF package references must be local canonical paths.",
  )
  const path = target?.replace(/^\//, "") ?? ""
  requireImport(
    path.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
    "unsafe-reference",
    "3MF package references must not traverse paths.",
  )
  return path
}
function modelPart(
  files: Readonly<Record<string, Uint8Array>>,
  limits: ImportLimits,
  budget: { nodes: number },
) {
  requireImport(
    Boolean(files["[Content_Types].xml"] && files["_rels/.rels"]),
    "invalid-format",
    "3MF package metadata is missing.",
  )
  const relations = parseImportXml(files["_rels/.rels"] as Uint8Array, limits, budget)
  requireImport(
    relations.local === "Relationships" && relations.namespace === RELATIONSHIP_NAMESPACE,
    "invalid-format",
    "3MF package relationships have the wrong namespace.",
  )
  let model: string | undefined
  for (const relation of relations.children) {
    requireImport(
      relation.local === "Relationship" && relation.namespace === RELATIONSHIP_NAMESPACE,
      "invalid-format",
      "Invalid 3MF relationship.",
    )
    requireImport(
      !relation.attributes.TargetMode || relation.attributes.TargetMode === "Internal",
      "unsafe-reference",
      "External 3MF references are forbidden.",
    )
    const path = canonicalPartPath(relation.attributes.Target)
    requireImport(
      Boolean(files[path]),
      "invalid-format",
      "A 3MF relationship references a missing archive entry.",
      path,
    )
    if (relation.attributes.Type === MODEL_RELATIONSHIP) {
      requireImport(!model, "invalid-format", "3MF requires one root model part.")
      model = path
    } else
      requireImport(
        relation.attributes.Type ===
          "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail",
        "unsupported-geometry",
        "Unsupported 3MF package relationship.",
        relation.attributes.Type,
      )
  }
  requireImport(Boolean(model), "invalid-format", "3MF has no root model relationship.")
  return model as string
}
function allowedArchivePath(path: string, model: string) {
  return (
    ["[Content_Types].xml", "_rels/.rels", model].includes(path) ||
    /^Metadata\/[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|xml|json|config|txt)$/.test(path) ||
    /^3D\/_rels\/[A-Za-z0-9_.-]+\.model\.rels$/.test(path)
  )
}

const CORE_MESH_PATH = ["model", "resources", "object", "mesh"] as const

function hasCoreMeshAncestors(ancestors: readonly Pick<ImportXmlNode, "local" | "namespace">[]) {
  return (
    ancestors.length === 5 &&
    ancestors.every((ancestor) => ancestor.namespace === THREE_MF_CORE_NAMESPACE) &&
    CORE_MESH_PATH.every((local, index) => ancestors[index]?.local === local)
  )
}

function coreMeshElementKind(
  element: Pick<ImportXmlNode, "local" | "namespace">,
  ancestors: readonly Pick<ImportXmlNode, "local" | "namespace">[],
) {
  if (element.namespace !== THREE_MF_CORE_NAMESPACE || !hasCoreMeshAncestors(ancestors))
    return undefined
  const parent = ancestors[4]?.local
  if (element.local === "vertex" && parent === "vertices") return "vertices"
  if (element.local === "triangle" && parent === "triangles") return "triangles"
  return undefined
}

function coreMeshGeometryBudget(limits: ImportLimits): ImportXmlGeometryBudget {
  const counts = { vertices: 0, triangles: 0 }
  return (element, ancestors) => {
    const kind = coreMeshElementKind(element, ancestors)
    if (!kind) return false
    counts[kind]++
    requireImport(counts[kind] <= limits[kind], "resource-limit", `3MF exceeds its ${kind} budget.`)
    return true
  }
}
function validateContentTypes(bytes: Uint8Array, limits: ImportLimits, budget: { nodes: number }) {
  const types = parseImportXml(bytes, limits, budget)
  requireImport(
    types.local === "Types" &&
      types.namespace === "http://schemas.openxmlformats.org/package/2006/content-types",
    "invalid-format",
    "3MF content types have the wrong namespace.",
  )
  for (const item of types.children)
    requireImport(
      item.namespace === types.namespace && ["Default", "Override"].includes(item.local),
      "invalid-format",
      "Invalid 3MF content type declaration.",
    )
}
function validateArchiveEntries(
  files: Readonly<Record<string, Uint8Array>>,
  model: string,
  limits: ImportLimits,
  budget: { nodes: number },
) {
  for (const [path, bytes] of Object.entries(files)) {
    requireImport(
      allowedArchivePath(path, model),
      "unsupported-geometry",
      "Unsupported 3MF archive entry.",
      path,
    )
    if (path.startsWith("Metadata/") && path.endsWith(".xml")) parseImportXml(bytes, limits, budget)
    if (!path.endsWith(".rels") || path === "_rels/.rels") continue
    const relations = parseImportXml(bytes, limits, budget)
    requireImport(
      relations.local === "Relationships" && relations.namespace === RELATIONSHIP_NAMESPACE,
      "invalid-format",
      "3MF model relationships have the wrong namespace.",
    )
    requireImport(
      relations.children.length === 0,
      "unsupported-geometry",
      "3MF model-part extension relationships are unsupported.",
      path,
    )
  }
  validateContentTypes(files["[Content_Types].xml"] as Uint8Array, limits, budget)
}
function resourceId(value: string | undefined) {
  const number = xmlNumber(value)
  requireImport(
    Number.isInteger(number) && number > 0 && number <= 2_147_483_647,
    "invalid-format",
    "3MF resource IDs must be positive integers.",
  )
  return number
}
function coreChildren(node: ImportXmlNode, allowed: readonly string[]) {
  for (const child of node.children)
    requireImport(
      child.namespace === THREE_MF_CORE_NAMESPACE && allowed.includes(child.local),
      "unsupported-geometry",
      "Unsupported 3MF geometry or extension element.",
      child.local,
    )
  for (const attribute of Object.keys(node.attributes))
    requireImport(
      !attribute.includes(":") ||
        attribute.startsWith("xmlns:") ||
        attribute === "xml:lang" ||
        attribute === "xml:space",
      "unsupported-geometry",
      "Unsupported 3MF extension attribute.",
      attribute,
    )
}
function threeMfTransform(value: string | undefined, scale: number) {
  if (value === undefined) return identityTransform()
  const values = value
    .trim()
    .split(/\s+/)
    .map((token) => xmlNumber(token))
  requireImport(values.length === 12, "invalid-format", "3MF transforms require twelve values.")
  const matrix = [
    values[0],
    values[1],
    values[2],
    0,
    values[3],
    values[4],
    values[5],
    0,
    values[6],
    values[7],
    values[8],
    0,
    (values[9] ?? 0) * scale,
    (values[10] ?? 0) * scale,
    (values[11] ?? 0) * scale,
    1,
  ] as number[]
  validateTransform(matrix)
  return matrix
}
type Component = Readonly<{ objectId: number; transform: number[] }>
type Resource = Readonly<{ id: number; meshId?: string; components?: Component[] }>
function readMesh(
  object: ImportXmlNode,
  scale: number,
  limits: ImportLimits,
  budget: { vertices: number; triangles: number },
): ImportedMesh {
  const mesh = xmlChild(object, "mesh")
  coreChildren(mesh, ["vertices", "triangles"])
  const verticesNode = xmlChild(mesh, "vertices")
  const trianglesNode = xmlChild(mesh, "triangles")
  coreChildren(verticesNode, ["vertex"])
  coreChildren(trianglesNode, ["triangle"])
  budget.vertices += verticesNode.children.length
  budget.triangles += trianglesNode.children.length
  requireImport(
    budget.vertices <= limits.vertices && budget.triangles <= limits.triangles,
    "resource-limit",
    "3MF resources exceed their mesh budget.",
  )
  const vertices = verticesNode.children.map((vertex) => {
    coreChildren(vertex, [])
    return scaledPoint3(
      xmlNumber(vertex.attributes.x),
      xmlNumber(vertex.attributes.y),
      xmlNumber(vertex.attributes.z),
      scale,
    )
  })
  const triangles = trianglesNode.children.map((triangle) => {
    coreChildren(triangle, [])
    const indexes = [triangle.attributes.v1, triangle.attributes.v2, triangle.attributes.v3].map(
      (value) => xmlNumber(value),
    )
    requireImport(
      indexes.every((index) => Number.isInteger(index) && index >= 0 && index < vertices.length),
      "invalid-geometry",
      "A 3MF triangle references a missing vertex.",
    )
    return indexes as [number, number, number]
  })
  requireImport(
    threeMfModelMeshSchema.safeParse({ vertices, triangles }).success,
    "invalid-geometry",
    "A 3MF model mesh must be a closed, consistently oriented solid.",
  )
  const label = importLabel(object.attributes.name ?? object.attributes.partnumber)
  return {
    id: `3mf-mesh-${resourceId(object.attributes.id)}`,
    ...(label ? { label } : {}),
    vertices,
    triangles,
  }
}
function resourcesFromModel(model: ImportXmlNode, scale: number, limits: ImportLimits) {
  const resources = xmlChild(model, "resources")
  coreChildren(resources, ["object"])
  requireImport(
    resources.children.length <= limits.bodies,
    "resource-limit",
    "3MF has too many resources.",
  )
  const records = new Map<number, Resource>()
  const meshes: ImportedMesh[] = []
  const budget = { vertices: 0, triangles: 0 }
  for (const object of resources.children) {
    coreChildren(object, ["mesh", "components"])
    requireImport(
      !object.attributes.type || object.attributes.type === "model",
      "unsupported-geometry",
      "Non-model 3MF objects require an explicit import policy.",
    )
    const id = resourceId(object.attributes.id)
    requireImport(!records.has(id), "invalid-format", "3MF resource IDs must be unique.")
    const mesh = xmlChildren(object, "mesh")
    const components = xmlChildren(object, "components")
    requireImport(
      mesh.length + components.length === 1,
      "invalid-format",
      "A 3MF object requires one mesh or component set.",
    )
    if (mesh.length) {
      const parsed = readMesh(object, scale, limits, budget)
      meshes.push(parsed)
      records.set(id, { id, meshId: parsed.id })
      continue
    }
    const children = xmlChild(object, "components")
    coreChildren(children, ["component"])
    requireImport(
      children.children.length > 0 && children.children.length <= limits.bodies,
      "resource-limit",
      "A 3MF component set is empty or oversized.",
    )
    records.set(id, {
      id,
      components: children.children.map((component) => {
        coreChildren(component, [])
        return {
          objectId: resourceId(component.attributes.objectid),
          transform: threeMfTransform(component.attributes.transform, scale),
        }
      }),
    })
  }
  return { records, meshes }
}
function validateResourceGraph(records: ReadonlyMap<number, Resource>, limits: ImportLimits) {
  const complete = new Map<number, number>()
  const visit = (id: number, ancestors: ReadonlySet<number>): number => {
    requireImport(!ancestors.has(id), "invalid-geometry", "3MF components contain a cycle.")
    requireImport(
      ancestors.size < limits.blockDepth,
      "resource-limit",
      "3MF components exceed their nesting budget.",
    )
    const resource = records.get(id)
    requireImport(
      Boolean(resource),
      "invalid-geometry",
      "3MF references an unknown object.",
      String(id),
    )
    const cachedDepth = complete.get(id)
    if (cachedDepth !== undefined) {
      requireImport(
        ancestors.size + cachedDepth <= limits.blockDepth,
        "resource-limit",
        "3MF components exceed their nesting budget.",
      )
      return cachedDepth
    }
    let depth = 1
    for (const component of resource?.components ?? [])
      depth = Math.max(depth, 1 + visit(component.objectId, new Set([...ancestors, id])))
    complete.set(id, depth)
    return depth
  }
  for (const id of records.keys()) visit(id, new Set())
}
function expandBuild(
  model: ImportXmlNode,
  records: ReadonlyMap<number, Resource>,
  scale: number,
  limits: ImportLimits,
) {
  const nodes: ImportedMeshNode[] = []
  const visit = (id: number, transform: number[], ancestors: ReadonlySet<number>) => {
    requireImport(!ancestors.has(id), "invalid-geometry", "3MF components contain a cycle.")
    requireImport(
      ancestors.size < limits.blockDepth,
      "resource-limit",
      "3MF components exceed their nesting budget.",
    )
    const resource = records.get(id)
    requireImport(
      Boolean(resource),
      "invalid-geometry",
      "3MF references an unknown object.",
      String(id),
    )
    if (resource?.meshId) {
      requireImport(
        nodes.length < limits.bodies,
        "resource-limit",
        "3MF build expansion exceeds its object budget.",
      )
      nodes.push({
        id: `3mf-node-${nodes.length + 1}`,
        meshId: resource.meshId,
        transform,
        reversesWinding: validateTransform(transform),
      })
      return
    }
    for (const component of resource?.components ?? [])
      visit(
        component.objectId,
        multiplyTransforms(transform, component.transform),
        new Set([...ancestors, id]),
      )
  }
  const build = xmlChild(model, "build")
  coreChildren(build, ["item"])
  requireImport(
    build.children.length <= limits.bodies,
    "resource-limit",
    "3MF has too many build items.",
  )
  for (const item of build.children) {
    coreChildren(item, [])
    requireImport(
      item.attributes.printable !== "0" && item.attributes.printable !== "false",
      "unsupported-geometry",
      "Non-printable 3MF build items require an explicit import policy.",
    )
    visit(
      resourceId(item.attributes.objectid),
      threeMfTransform(item.attributes.transform, scale),
      new Set(),
    )
  }
  return nodes
}
export async function parseThreeMfGeometry(
  bytes: Uint8Array,
  limits: ImportLimits,
): Promise<ParsedGeometryImport> {
  const files = await readSafeZip(bytes, {
    archiveBytes: limits.fileBytes,
    entryBytes: limits.expandedBytes,
    expandedBytes: limits.expandedBytes,
    entryCount: limits.zipEntries,
    pathLength: 1024,
    compressionRatio: limits.compressionRatio,
  })
  const budget = { nodes: 0 }
  const part = modelPart(files, limits, budget)
  validateArchiveEntries(files, part, limits, budget)
  // Geometry leaves use the aggregate mesh budgets; all wrappers and other parts retain XML limits.
  const model = parseImportXml(
    files[part] as Uint8Array,
    limits,
    budget,
    coreMeshGeometryBudget(limits),
  )
  requireImport(
    model.local === "model" && model.namespace === THREE_MF_CORE_NAMESPACE,
    "invalid-format",
    "3MF model has the wrong root namespace.",
  )
  coreChildren(model, ["metadata", "resources", "build"])
  for (const prefix of (model.attributes.requiredextensions ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean))
    requireImport(
      model.attributes[`xmlns:${prefix}`] === THREE_MF_CORE_NAMESPACE,
      "unsupported-geometry",
      "3MF requires an unsupported extension.",
      prefix,
    )
  const sourceUnit = model.attributes.unit ?? "millimeter"
  const scale = UNIT_MM[sourceUnit]
  requireImport(
    scale !== undefined,
    "invalid-format",
    "3MF declares an unsupported unit.",
    sourceUnit,
  )
  const { records, meshes } = resourcesFromModel(model, scale, limits)
  validateResourceGraph(records, limits)
  const nodes = expandBuild(model, records, scale, limits)
  return {
    kind: "triangle-mesh",
    format: "3mf",
    units: { coordinateUnit: "mm", sourceUnit, millimetersPerUnit: scale, policy: "declared" },
    meshes,
    nodes,
    warnings: [],
  }
}
