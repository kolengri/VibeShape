import { meshImportInspectionSchema } from "@vibeshape/protocol"
import {
  encodeStructuralSnapshot,
  type StructuralSnapshot,
} from "@vibeshape/structural-optimization/mesh"
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
  ) => StructuralSnapshot = encodeStructuralSnapshot,
) {
  const snapshot = encode(mesh, cellSizeMm)
  const file = new File(
    [snapshot.bytes],
    `${portableDocumentStem(source.partName)}-${suffix}.${snapshot.format}`,
    { type: snapshot.mediaType },
  )
  const prepared = await readImportSource(file, snapshot.format === "3mf" ? null : "millimeter")
  if (!current() || prepared.representation !== "triangle-mesh") return null
  const inspection = meshImportInspectionSchema.parse(
    await inspectTriangleMeshSource(prepared.input),
  )
  return current() ? { prepared, inspection } : null
}
