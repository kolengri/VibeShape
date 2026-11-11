import { writeGlbMeshes } from "@vibeshape/formats/gltf-meshes"
import { writeObjArchive } from "@vibeshape/formats/obj-meshes"
import type { VisualMeshExportInput } from "@vibeshape/formats/visual-meshes"
import type { GeometryExportFormat } from "@vibeshape/protocol"

export type VisualMeshExportFormat = Extract<GeometryExportFormat, "glb" | "obj">

export function isVisualMeshExportFormat(
  format: GeometryExportFormat,
): format is VisualMeshExportFormat {
  return format === "glb" || format === "obj"
}

/** OBJ is delivered as a ZIP so its MTL material library always travels with it. */
export function writeVisualMeshExport(
  format: VisualMeshExportFormat,
  input: VisualMeshExportInput,
) {
  return format === "glb" ? writeGlbMeshes(input) : writeObjArchive(input)
}
