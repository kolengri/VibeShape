import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { DocumentSnapshot } from "@vibeshape/domain"
import { useMemo } from "react"
import { referenceFrameOptions } from "./reference-frame-options"

/** Replaced semantic or rebuilt input invalidates every projected support reference. */
export function useReferenceFrameOptions(
  snapshot: DocumentSnapshot,
  rebuild: DocumentRebuildOutcome,
  excludedFeatureId?: string,
) {
  return useMemo(
    () => referenceFrameOptions(snapshot, rebuild, excludedFeatureId),
    [snapshot, rebuild, excludedFeatureId],
  )
}
