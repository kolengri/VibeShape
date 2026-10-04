import type { FeatureId } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"

export type ShellPickingContext = Readonly<{
  featureId: FeatureId
  targetBody: BodyReference
  evidence: ModelBodyTopologyEvidence
  openingIds: readonly string[]
}>

export type ShellPickRequest = Readonly<{
  featureId: FeatureId
  sourceContentHash: string
  candidateId: string
  sequence: number
}>
