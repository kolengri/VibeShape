import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import {
  materializeSketchDisplay,
  type SketchDisplayRecord,
} from "@vibeshape/application/sketch-display"
import type { DocumentSnapshot, FeatureRecord } from "@vibeshape/domain"
import type { SketchSolveCache } from "./external-sketch-references"
import { solveSketchOnce } from "./extrusion-content"
import type { SketchSolvePort } from "./runtime"

export async function createSketchDisplayRecords(
  document: DocumentSnapshot,
  solveSketch: SketchSolvePort | null,
  solvedBySketchId: SketchSolveCache,
  features: readonly FeatureRecord[] = document.features,
  geometry: readonly FeatureGeometryRecord[] = [],
): Promise<readonly SketchDisplayRecord[]> {
  const records: SketchDisplayRecord[] = []
  for (const sketch of document.sketches) {
    let result = null
    if (solveSketch) {
      try {
        result = await solveSketchOnce(
          solvedBySketchId,
          solveSketch,
          document,
          sketch,
          features,
          geometry,
        )
      } catch {
        // The authored fallback keeps a broken sketch inspectable without failing the solid rebuild.
      }
    }
    const record = materializeSketchDisplay(
      document,
      sketch,
      result?.ok ? result.solution : null,
      features,
    )
    if (record) records.push(record)
  }
  return records
}
