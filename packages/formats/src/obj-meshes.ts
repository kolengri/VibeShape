import { strToU8, zipSync } from "fflate"
import {
  collectVisualMaterials,
  fixedDecimal,
  srgbChannels,
  type VisualMeshExportInput,
  visualMeshExportInputSchema,
  visualMeshName,
} from "./visual-meshes"

const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0)
export const OBJ_ARCHIVE_OBJ_ENTRY = "model.obj"
export const OBJ_ARCHIVE_MTL_ENTRY = "model.mtl"

function materialName(index: number) {
  return `material_${index + 1}`
}

/**
 * Writes Wavefront OBJ text plus its MTL library. Coordinates stay in VibeShape millimeters and
 * right-handed Z-up axes, matching STL and 3MF exports; indices are global and one-based.
 */
export function writeObjMeshes(input: VisualMeshExportInput) {
  const parsed = visualMeshExportInputSchema.parse(input)
  const { materials, meshMaterials } = collectVisualMaterials(parsed.meshes)
  const obj = [
    "# VibeShape OBJ export",
    "# Units: millimeters. Axes: right-handed, Z up.",
    `mtllib ${OBJ_ARCHIVE_MTL_ENTRY}`,
  ]
  let vertexBase = 1
  parsed.meshes.forEach((mesh, index) => {
    obj.push(`o ${visualMeshName(mesh.name, index)}`)
    for (let offset = 0; offset < mesh.vertices.length; offset += 3)
      obj.push(
        `v ${fixedDecimal(mesh.vertices[offset] as number)} ${fixedDecimal(
          mesh.vertices[offset + 1] as number,
        )} ${fixedDecimal(mesh.vertices[offset + 2] as number)}`,
      )
    obj.push(`usemtl ${materialName(meshMaterials[index] as number)}`)
    for (let offset = 0; offset < mesh.triangles.length; offset += 3)
      obj.push(
        `f ${(mesh.triangles[offset] as number) + vertexBase} ${
          (mesh.triangles[offset + 1] as number) + vertexBase
        } ${(mesh.triangles[offset + 2] as number) + vertexBase}`,
      )
    vertexBase += mesh.vertices.length / 3
  })
  const mtl = ["# VibeShape MTL export (display colors only; no physical material claims)"]
  materials.forEach((material, index) => {
    const [red, green, blue] = srgbChannels(material.color).map((channel) => fixedDecimal(channel))
    mtl.push(
      "",
      `newmtl ${materialName(index)}`,
      "Ka 0 0 0",
      `Kd ${red} ${green} ${blue}`,
      "Ks 0 0 0",
      `d ${fixedDecimal(material.opacity)}`,
      "illum 1",
      `Pr ${fixedDecimal(material.roughness)}`,
      `Pm ${fixedDecimal(material.metalness)}`,
    )
  })
  return { obj: `${obj.join("\n")}\n`, mtl: `${mtl.join("\n")}\n` }
}

/** Packages the OBJ and its referenced MTL so the material library cannot be separated. */
export function writeObjArchive(input: VisualMeshExportInput): Uint8Array<ArrayBuffer> {
  const { obj, mtl } = writeObjMeshes(input)
  const archive = zipSync(
    { [OBJ_ARCHIVE_OBJ_ENTRY]: strToU8(obj), [OBJ_ARCHIVE_MTL_ENTRY]: strToU8(mtl) },
    { level: 6, mtime: ZIP_MTIME },
  )
  return Uint8Array.from(archive)
}
