import { meshImportInspectionSchema } from "@vibeshape/protocol"
import { encodeStructuralStl } from "@vibeshape/structural-optimization/mesh"
import { inspectTriangleMeshSource } from "../../document/document-controller"
import { portableDocumentStem } from "../../document/document-export"
import { readImportSource } from "../import/import-model"
import type { LightweightingSource } from "./lightweighting-model"

/** Both workflows inspect a disposable mesh before the ordinary import transaction. */
export async function prepareLightweightingSnapshot(
  mesh: { vertices: number[]; indices: number[] },
  cellSizeMm: number,
  source: LightweightingSource,
  current: () => boolean,
  suffix = "lightweight",
  encode: (
    mesh: { vertices: number[]; indices: number[] },
    cellSizeMm: number,
  ) => Uint8Array = encodeStructuralStl,
) {
  const bytes = encode(mesh, cellSizeMm)
  const file = new File(
    [Uint8Array.from(bytes).buffer],
    `${portableDocumentStem(source.partName)}-${suffix}.stl`,
    { type: "model/stl" },
  )
  const prepared = await readImportSource(file, "millimeter")
  if (!current() || prepared.representation !== "triangle-mesh") return null
  const inspection = meshImportInspectionSchema.parse(
    await inspectTriangleMeshSource(prepared.input),
  )
  return current() ? { prepared, inspection } : null
}
