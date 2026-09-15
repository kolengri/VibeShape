import { createModelBodyMeasurementEvidence } from "@vibeshape/application/model-measurements"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { terminalBodyOutputs } from "@vibeshape/domain/model-bodies"
import {
  bodyMeasurementOutputs,
  type ModelBodyMeasurementEntry,
} from "@vibeshape/domain/model-body-measurements"
import { eligibleHoleTargetFeatures } from "../part-design/part-design-tool"

export const holeTargetBodyKey = (featureId: string, outputRole?: string) =>
  `${featureId}\u0000${outputRole ?? ""}`

export type HoleTargetBodyOption = Readonly<{
  featureId: FeatureId
  outputRole?: string
  label: string
  missing?: boolean
}>

type Target = Readonly<{ featureId: FeatureId; outputRole?: string | undefined }>
type Args = Readonly<{
  snapshot: DocumentSnapshot
  rebuild: DocumentRebuildOutcome
  editingFeatureId?: FeatureId | undefined
  currentTarget?: Target | undefined
  unnamedFeature: string
  formatRole: (feature: string, role: string) => string
  missingRole: (feature: string, role: string) => string
}>

function targetLabel(target: Target, args: Args) {
  const feature = args.snapshot.features.find(({ id }) => id === target.featureId)
  const label = feature?.label ?? args.unnamedFeature
  return target.outputRole ? args.missingRole(label, target.outputRole) : label
}

function addCurrentTarget(options: HoleTargetBodyOption[], args: Args) {
  const target = args.currentTarget
  if (!target) return options
  const key = holeTargetBodyKey(target.featureId, target.outputRole)
  if (!options.some((option) => holeTargetBodyKey(option.featureId, option.outputRole) === key))
    options.push({
      featureId: target.featureId,
      ...(target.outputRole === undefined ? {} : { outputRole: target.outputRole }),
      label: targetLabel(target, args),
      missing: true,
    })
  return options
}

function bodyOption(
  body: ModelBodyMeasurementEntry,
  feature: FeatureRecord,
  args: Args,
): HoleTargetBodyOption {
  const label = feature.label ?? args.unnamedFeature
  return {
    featureId: feature.id,
    ...(body.outputRole === undefined ? {} : { outputRole: body.outputRole }),
    label:
      body.outputRole && body.outputRole !== "result"
        ? args.formatRole(label, body.outputRole)
        : label,
  }
}

function eligibleBodyOutputs(args: Args, evidence: Parameters<typeof bodyMeasurementOutputs>[1]) {
  const all = bodyMeasurementOutputs(args.snapshot.features, evidence)
  if (!all) return null
  const eligible = eligibleHoleTargetFeatures(args.snapshot.features, args.editingFeatureId)
  const features = new Map<string, FeatureRecord>(eligible.map((feature) => [feature.id, feature]))
  const byFeature = new Map([...all].filter(([id]) => features.has(id)))
  const terminal = terminalBodyOutputs(args.snapshot.features, byFeature)
  if (!terminal) return null
  const current = args.currentTarget
  const selected = current
    ? byFeature.get(current.featureId)?.find((body) => body.outputRole === current.outputRole)
    : undefined
  if (selected && !terminal.includes(selected)) return { bodies: [...terminal, selected], features }
  return { bodies: terminal, features }
}

function preserveLegacyTarget(
  options: HoleTargetBodyOption[],
  args: Args,
  evidence: Parameters<typeof bodyMeasurementOutputs>[1],
  features: ReadonlyMap<string, FeatureRecord>,
) {
  const target = args.currentTarget
  if (!target || target.outputRole !== undefined || !features.has(target.featureId)) return
  const root = evidence.features.find((entry) => entry.featureId === target.featureId)
  if (root?.status !== "succeeded" || root.shape.solidCount !== 1) return
  if (
    options.some(
      (option) => option.featureId === target.featureId && option.outputRole === undefined,
    )
  )
    return
  options.unshift({ featureId: target.featureId, label: targetLabel(target, args) })
}

/** Exact current targets; editing releases the edited feature and its descendants' consumption. */
export function holeTargetBodyOptions(args: Args): readonly HoleTargetBodyOption[] {
  const source = createModelBodyMeasurementEvidence(args.snapshot, args.rebuild)
  if (!source.ok) return addCurrentTarget([], args)
  const projected = eligibleBodyOutputs(args, source.evidence)
  if (!projected) return addCurrentTarget([], args)
  const options: HoleTargetBodyOption[] = []
  for (const body of projected.bodies) {
    const feature = projected.features.get(body.featureId)
    if (feature && body.shape.solidCount === 1) options.push(bodyOption(body, feature, args))
  }
  preserveLegacyTarget(options, args, source.evidence, projected.features)
  return addCurrentTarget(options, args)
}
