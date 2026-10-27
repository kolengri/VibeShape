import type { HistoryItemRef } from "@vibeshape/domain"
import type { FeatureId } from "@vibeshape/domain/identifiers"

export type HistoryRevealRequest = Readonly<
  { sequence: number } & (
    | { featureId: FeatureId; destination?: "browser" | "timeline"; historyItem?: never }
    | { historyItem: HistoryItemRef; destination: "timeline"; featureId?: never }
  )
>
