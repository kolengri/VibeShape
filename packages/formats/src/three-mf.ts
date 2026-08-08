import { strToU8, type Zippable, zipSync } from "fflate"
import { z } from "zod"

export const THREE_MF_MEDIA_TYPE = "model/3mf" as const
export const THREE_MF_CORE_NAMESPACE =
  "http://schemas.microsoft.com/3dmanufacturing/core/2015/02" as const

const MAX_RESOURCE_ID = 2_147_483_647
const MAX_OBJECTS = 10_000
const MAX_VERTICES = 1_000_000
const MAX_TRIANGLES = 2_000_000
const MAX_COMPONENTS = 100_000
const MAX_BUILD_ITEMS = 10_000
const MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024
const GEOMETRY_EPSILON = 1e-12
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0)

const finiteNumberSchema = z.number().finite()
const resourceIdSchema = z.number().int().min(1).max(MAX_RESOURCE_ID)
const resourceIndexSchema = z.number().int().min(0).max(MAX_RESOURCE_ID)
const vector3Schema = z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema])
const triangleSchema = z.tuple([resourceIndexSchema, resourceIndexSchema, resourceIndexSchema])
const XML_WHITESPACE = new Set([0x09, 0x0a, 0x0d])
const XML_CHARACTER_RANGES = [
  [0x20, 0xd7ff],
  [0xe000, 0xfffd],
  [0x10000, 0x10ffff],
] as const

function isAllowedXmlCodePoint(codePoint: number) {
  return (
    XML_WHITESPACE.has(codePoint) ||
    XML_CHARACTER_RANGES.some(([minimum, maximum]) => codePoint >= minimum && codePoint <= maximum)
  )
}

function isValidXmlText(value: string) {
  return [...value].every((character) => isAllowedXmlCodePoint(character.codePointAt(0) as number))
}

const xmlTextSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(isValidXmlText, "Text contains a character forbidden by XML 1.0.")
const languageSchema = z
  .string()
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, "Language must be a BCP 47 tag.")

function transformDeterminant(transform: readonly number[]) {
  const [a, b, c, d, e, f, g, h, i] = transform as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

export const threeMfTransformSchema = z
  .tuple([
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
    finiteNumberSchema,
  ])
  .refine(
    (transform) => transformDeterminant(transform) > GEOMETRY_EPSILON,
    "3MF transforms must be non-singular and preserve positive orientation.",
  )

const meshBaseSchema = z
  .object({
    vertices: z.array(vector3Schema).min(4).max(MAX_VERTICES),
    triangles: z.array(triangleSchema).min(4).max(MAX_TRIANGLES),
  })
  .strict()

type MeshValues = z.infer<typeof meshBaseSchema>

const meshSchema = meshBaseSchema.superRefine(validateMesh)

const meshObjectSchema = z
  .object({
    kind: z.literal("mesh"),
    id: resourceIdSchema,
    name: xmlTextSchema.optional(),
    partNumber: xmlTextSchema.optional(),
    mesh: meshSchema,
  })
  .strict()

const componentSchema = z
  .object({
    objectId: resourceIdSchema,
    transform: threeMfTransformSchema.optional(),
  })
  .strict()

const componentsObjectSchema = z
  .object({
    kind: z.literal("components"),
    id: resourceIdSchema,
    name: xmlTextSchema.optional(),
    partNumber: xmlTextSchema.optional(),
    components: z.array(componentSchema).min(1).max(MAX_COMPONENTS),
  })
  .strict()

const buildItemSchema = z
  .object({
    objectId: resourceIdSchema,
    transform: threeMfTransformSchema.optional(),
    partNumber: xmlTextSchema.optional(),
  })
  .strict()

const metadataSchema = z
  .object({
    title: xmlTextSchema.optional(),
    designer: xmlTextSchema.optional(),
    description: xmlTextSchema.optional(),
    copyright: xmlTextSchema.optional(),
    licenseTerms: xmlTextSchema.optional(),
    application: xmlTextSchema.optional(),
    creationDate: z.iso.datetime({ offset: true }).optional(),
    modificationDate: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()

const thumbnailBaseSchema = z
  .object({
    mediaType: z.enum(["image/png", "image/jpeg"]),
    data: z.instanceof(Uint8Array).refine((data) => data.byteLength <= MAX_THUMBNAIL_BYTES),
  })
  .strict()

type ThumbnailValues = z.infer<typeof thumbnailBaseSchema>

const thumbnailSchema = thumbnailBaseSchema.refine(
  hasMatchingThumbnailSignature,
  "Thumbnail bytes do not match their media type.",
)

const threeMfDocumentBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: languageSchema.default("en-US"),
    metadata: metadataSchema.optional(),
    objects: z
      .array(z.discriminatedUnion("kind", [meshObjectSchema, componentsObjectSchema]))
      .min(1)
      .max(MAX_OBJECTS),
    build: z.array(buildItemSchema).min(1).max(MAX_BUILD_ITEMS),
    thumbnail: thumbnailSchema.optional(),
  })
  .strict()

type ThreeMfDocumentValues = z.infer<typeof threeMfDocumentBaseSchema>

export const threeMfDocumentSchema = threeMfDocumentBaseSchema.superRefine(validateDocument)

export const threeMfExportReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    mediaType: z.literal(THREE_MF_MEDIA_TYPE),
    unit: z.literal("millimeter"),
    objectCount: z.number().int().positive(),
    meshObjectCount: z.number().int().nonnegative(),
    componentObjectCount: z.number().int().nonnegative(),
    buildItemCount: z.number().int().positive(),
    vertexCount: z.number().int().nonnegative(),
    triangleCount: z.number().int().nonnegative(),
    hasThumbnail: z.boolean(),
    archiveBytes: z.number().int().positive(),
  })
  .strict()

export type ThreeMfDocument = z.infer<typeof threeMfDocumentSchema>
export type ThreeMfDocumentInput = z.input<typeof threeMfDocumentSchema>
export type ThreeMfExportReport = z.infer<typeof threeMfExportReportSchema>
export type ThreeMfTransform = z.infer<typeof threeMfTransformSchema>

type Vector3 = z.infer<typeof vector3Schema>
type Triangle = z.infer<typeof triangleSchema>

function vectorSubtract(left: readonly number[], right: readonly number[]) {
  return left.map((value, index) => value - (right[index] as number))
}

function cross(left: readonly number[], right: readonly number[]) {
  return [
    (left[1] as number) * (right[2] as number) - (left[2] as number) * (right[1] as number),
    (left[2] as number) * (right[0] as number) - (left[0] as number) * (right[2] as number),
    (left[0] as number) * (right[1] as number) - (left[1] as number) * (right[0] as number),
  ]
}

function dot(left: readonly number[], right: readonly number[]) {
  return left.reduce((sum, component, index) => sum + component * (right[index] as number), 0)
}

function triangleVertices(mesh: MeshValues, triangle: Triangle): [Vector3, Vector3, Vector3] {
  return [
    mesh.vertices[triangle[0]] as Vector3,
    mesh.vertices[triangle[1]] as Vector3,
    mesh.vertices[triangle[2]] as Vector3,
  ]
}

function validateTriangle(
  mesh: MeshValues,
  triangle: Triangle,
  index: number,
  context: z.RefinementCtx,
) {
  if (triangle.some((vertexIndex) => vertexIndex >= mesh.vertices.length)) {
    context.addIssue({
      code: "custom",
      message: "Triangle references a vertex outside the mesh.",
      path: ["triangles", index],
    })
    return false
  }
  if (new Set(triangle).size !== 3) {
    context.addIssue({
      code: "custom",
      message: "Triangle must reference three distinct vertices.",
      path: ["triangles", index],
    })
    return false
  }
  const [first, second, third] = triangleVertices(mesh, triangle)
  const normal = cross(vectorSubtract(second, first), vectorSubtract(third, first))
  if (Math.hypot(...normal) <= GEOMETRY_EPSILON) {
    context.addIssue({
      code: "custom",
      message: "Triangle must have non-zero area.",
      path: ["triangles", index],
    })
    return false
  }
  return true
}

interface EdgeUse {
  from: number
  to: number
  triangleIndex: number
}

function collectEdgeUses(triangles: readonly Triangle[]) {
  const edges = new Map<string, EdgeUse[]>()
  for (const [triangleIndex, [first, second, third]] of triangles.entries()) {
    for (const [from, to] of [
      [first, second],
      [second, third],
      [third, first],
    ] as const) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`
      const uses = edges.get(key) ?? []
      uses.push({ from, to, triangleIndex })
      edges.set(key, uses)
    }
  }
  return edges
}

function validateManifoldEdges(mesh: MeshValues, context: z.RefinementCtx) {
  for (const [edge, uses] of collectEdgeUses(mesh.triangles)) {
    if (uses.length !== 2) {
      context.addIssue({
        code: "custom",
        message: `Mesh edge ${edge} must be shared by exactly two triangles.`,
        path: ["triangles"],
      })
      return false
    }
    const [first, second] = uses as [EdgeUse, EdgeUse]
    if (first.from !== second.to || first.to !== second.from) {
      context.addIssue({
        code: "custom",
        message: `Mesh edge ${edge} has inconsistent triangle orientation.`,
        path: ["triangles"],
      })
      return false
    }
  }
  return true
}

function signedTriangleVolume(mesh: MeshValues, triangleIndex: number, origin: Vector3) {
  const triangle = mesh.triangles[triangleIndex] as Triangle
  const [first, second, third] = triangleVertices(mesh, triangle)
  return (
    dot(
      vectorSubtract(first, origin),
      cross(vectorSubtract(second, origin), vectorSubtract(third, origin)),
    ) / 6
  )
}

function collectTriangleComponents(mesh: MeshValues) {
  const neighbors = mesh.triangles.map(() => new Set<number>())
  for (const uses of collectEdgeUses(mesh.triangles).values()) {
    if (uses.length !== 2) continue
    const [first, second] = uses as [EdgeUse, EdgeUse]
    neighbors[first.triangleIndex]?.add(second.triangleIndex)
    neighbors[second.triangleIndex]?.add(first.triangleIndex)
  }
  const visited = new Set<number>()
  const components: number[][] = []
  for (const triangleIndex of mesh.triangles.keys()) {
    if (visited.has(triangleIndex)) continue
    const component: number[] = []
    const pending = [triangleIndex]
    visited.add(triangleIndex)
    while (pending.length > 0) {
      const current = pending.pop() as number
      component.push(current)
      for (const neighbor of neighbors[current] as Set<number>) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        pending.push(neighbor)
      }
    }
    components.push(component)
  }
  return components
}

function validatePositiveComponentVolumes(mesh: MeshValues, context: z.RefinementCtx) {
  for (const [componentIndex, triangleIndices] of collectTriangleComponents(mesh).entries()) {
    const firstTriangle = mesh.triangles[triangleIndices[0] as number] as Triangle
    const origin = triangleVertices(mesh, firstTriangle)[0]
    const volume = triangleIndices.reduce(
      (sum, triangleIndex) => sum + signedTriangleVolume(mesh, triangleIndex, origin),
      0,
    )
    if (volume > GEOMETRY_EPSILON) continue
    context.addIssue({
      code: "custom",
      message: `Model mesh component ${componentIndex} must have outward orientation and positive volume.`,
      path: ["triangles"],
    })
  }
}

function validateMesh(mesh: MeshValues, context: z.RefinementCtx) {
  const validTriangles = mesh.triangles.map((triangle, index) =>
    validateTriangle(mesh, triangle, index, context),
  )
  if (validTriangles.includes(false)) return
  if (!validateManifoldEdges(mesh, context)) return
  validatePositiveComponentVolumes(mesh, context)
}

function hasBytes(data: Uint8Array, expected: readonly number[]) {
  return expected.every((byte, index) => data[index] === byte)
}

function hasMatchingThumbnailSignature(thumbnail: ThumbnailValues) {
  if (thumbnail.mediaType === "image/png") {
    return hasBytes(thumbnail.data, [137, 80, 78, 71, 13, 10, 26, 10])
  }
  return hasBytes(thumbnail.data, [255, 216, 255])
}

function validateResourceReferences(document: ThreeMfDocumentValues, context: z.RefinementCtx) {
  const defined = new Set<number>()
  for (const [objectIndex, object] of document.objects.entries()) {
    if (defined.has(object.id)) {
      context.addIssue({
        code: "custom",
        message: "3MF resource IDs must be unique.",
        path: ["objects", objectIndex, "id"],
      })
    }
    if (object.kind === "components") {
      for (const [componentIndex, component] of object.components.entries()) {
        if (!defined.has(component.objectId)) {
          context.addIssue({
            code: "custom",
            message: "Component objects must reference an earlier resource.",
            path: ["objects", objectIndex, "components", componentIndex, "objectId"],
          })
        }
      }
    }
    defined.add(object.id)
  }
  for (const [itemIndex, item] of document.build.entries()) {
    if (!defined.has(item.objectId)) {
      context.addIssue({
        code: "custom",
        message: "Build items must reference a defined object resource.",
        path: ["build", itemIndex, "objectId"],
      })
    }
  }
}

function validatePartNumbers(document: ThreeMfDocumentValues, context: z.RefinementCtx) {
  const seen = new Set<string>()
  for (const [itemIndex, item] of document.build.entries()) {
    if (!item.partNumber) continue
    if (seen.has(item.partNumber)) {
      context.addIssue({
        code: "custom",
        message: "Build item part numbers must be unique.",
        path: ["build", itemIndex, "partNumber"],
      })
    }
    seen.add(item.partNumber)
  }
}

function validateTotalMeshSize(document: ThreeMfDocumentValues, context: z.RefinementCtx) {
  const meshes = document.objects.filter((object) => object.kind === "mesh")
  const vertexCount = meshes.reduce((sum, object) => sum + object.mesh.vertices.length, 0)
  const triangleCount = meshes.reduce((sum, object) => sum + object.mesh.triangles.length, 0)
  if (vertexCount > MAX_VERTICES || triangleCount > MAX_TRIANGLES) {
    context.addIssue({
      code: "custom",
      message: "3MF document exceeds the initial mesh resource budget.",
      path: ["objects"],
    })
  }
}

function validateDocument(document: ThreeMfDocumentValues, context: z.RefinementCtx) {
  validateResourceReferences(document, context)
  validatePartNumbers(document, context)
  validateTotalMeshSize(document, context)
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function formatNumber(value: number) {
  return Object.is(value, -0) ? "0" : String(value)
}

function transformAttribute(transform: readonly number[] | undefined) {
  return transform ? ` transform="${transform.map(formatNumber).join(" ")}"` : ""
}

function objectAttributes(object: ThreeMfDocument["objects"][number]) {
  return [
    `id="${object.id}"`,
    'type="model"',
    ...(object.name ? [`name="${escapeXml(object.name)}"`] : []),
    ...(object.partNumber ? [`partnumber="${escapeXml(object.partNumber)}"`] : []),
  ].join(" ")
}

function renderMeshObject(object: Extract<ThreeMfDocument["objects"][number], { kind: "mesh" }>) {
  const vertices = object.mesh.vertices.map(
    ([x, y, z]) =>
      `          <vertex x="${formatNumber(x)}" y="${formatNumber(y)}" z="${formatNumber(z)}" />`,
  )
  const triangles = object.mesh.triangles.map(
    ([v1, v2, v3]) => `          <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`,
  )
  return [
    `    <object ${objectAttributes(object)}>`,
    "      <mesh>",
    "        <vertices>",
    ...vertices,
    "        </vertices>",
    "        <triangles>",
    ...triangles,
    "        </triangles>",
    "      </mesh>",
    "    </object>",
  ]
}

function renderComponentsObject(
  object: Extract<ThreeMfDocument["objects"][number], { kind: "components" }>,
) {
  return [
    `    <object ${objectAttributes(object)}>`,
    "      <components>",
    ...object.components.map(
      (component) =>
        `        <component objectid="${component.objectId}"${transformAttribute(component.transform)} />`,
    ),
    "      </components>",
    "    </object>",
  ]
}

function renderMetadata(document: ThreeMfDocument) {
  const metadata = document.metadata ?? {}
  const entries: Array<readonly [string, string | undefined]> = [
    ["Title", metadata.title],
    ["Designer", metadata.designer],
    ["Description", metadata.description],
    ["Copyright", metadata.copyright],
    ["LicenseTerms", metadata.licenseTerms],
    ["Application", metadata.application ?? "VibeShape"],
    ["CreationDate", metadata.creationDate],
    ["ModificationDate", metadata.modificationDate],
  ]
  return entries.flatMap(([name, value]) =>
    value ? [`  <metadata name="${name}">${escapeXml(value)}</metadata>`] : [],
  )
}

function renderModel(document: ThreeMfDocument) {
  const resources = document.objects.flatMap((object) =>
    object.kind === "mesh" ? renderMeshObject(object) : renderComponentsObject(object),
  )
  const build = document.build.map(
    (item) =>
      `    <item objectid="${item.objectId}"${transformAttribute(item.transform)}${item.partNumber ? ` partnumber="${escapeXml(item.partNumber)}"` : ""} />`,
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="${escapeXml(document.language)}" xmlns="${THREE_MF_CORE_NAMESPACE}">`,
    ...renderMetadata(document),
    "  <resources>",
    ...resources,
    "  </resources>",
    "  <build>",
    ...build,
    "  </build>",
    "</model>",
    "",
  ].join("\n")
}

function thumbnailExtension(mediaType: "image/png" | "image/jpeg") {
  return mediaType === "image/png" ? "png" : "jpg"
}

function renderContentTypes(document: ThreeMfDocument) {
  const thumbnail = document.thumbnail
    ? `  <Default Extension="${thumbnailExtension(document.thumbnail.mediaType)}" ContentType="${document.thumbnail.mediaType}" />`
    : null
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />',
    '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />',
    ...(thumbnail ? [thumbnail] : []),
    "</Types>",
    "",
  ].join("\n")
}

function renderRelationships(document: ThreeMfDocument) {
  const thumbnail = document.thumbnail
    ? `  <Relationship Target="/Metadata/thumbnail.${thumbnailExtension(document.thumbnail.mediaType)}" Id="thumbnail" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" />`
    : null
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />',
    ...(thumbnail ? [thumbnail] : []),
    "</Relationships>",
    "",
  ].join("\n")
}

function createArchiveEntries(document: ThreeMfDocument): Zippable {
  const entries: Zippable = {
    "[Content_Types].xml": strToU8(renderContentTypes(document)),
    "_rels/.rels": strToU8(renderRelationships(document)),
    "3D/3dmodel.model": strToU8(renderModel(document)),
  }
  if (document.thumbnail) {
    entries[`Metadata/thumbnail.${thumbnailExtension(document.thumbnail.mediaType)}`] = [
      document.thumbnail.data,
      { level: 0, mtime: ZIP_MTIME },
    ]
  }
  return entries
}

function createExportReport(document: ThreeMfDocument, archiveBytes: number) {
  const meshes = document.objects.filter((object) => object.kind === "mesh")
  return threeMfExportReportSchema.parse({
    schemaVersion: 1,
    mediaType: THREE_MF_MEDIA_TYPE,
    unit: "millimeter",
    objectCount: document.objects.length,
    meshObjectCount: meshes.length,
    componentObjectCount: document.objects.length - meshes.length,
    buildItemCount: document.build.length,
    vertexCount: meshes.reduce((sum, object) => sum + object.mesh.vertices.length, 0),
    triangleCount: meshes.reduce((sum, object) => sum + object.mesh.triangles.length, 0),
    hasThumbnail: document.thumbnail !== undefined,
    archiveBytes,
  })
}

export function writeThreeMf(input: ThreeMfDocumentInput) {
  const document = threeMfDocumentSchema.parse(input)
  const bytes = zipSync(createArchiveEntries(document), { level: 6, mtime: ZIP_MTIME })
  return { bytes, report: createExportReport(document, bytes.byteLength) }
}
