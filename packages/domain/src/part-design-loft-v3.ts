import { z } from "zod"
import { bodyFaceRefSchema } from "./body-topology-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { sketchEntityIdSchema } from "./identifiers"
import { sketchPathSelectorSchema } from "./sketch-path-selector"
import { sketchProfileSelectorKey, sketchProfileSelectorSchema } from "./sketch-profile-selector"

export const MAX_LOFT_V3_DEPENDENCIES = 128
const trackIndex = z.number().int().min(0).max(63)
const endConstraint = z
  .object({
    segmentTrack: trackIndex,
    continuity: z.enum(["G1", "G2"]),
    support: bodyFaceRefSchema,
  })
  .strict()
export const loftFeatureParametersV3Schema = z
  .object({
    sections: z.array(sketchProfileSelectorSchema).min(2).max(24),
    ruled: z.literal(false),
    outerCorrespondence: z
      .array(
        z
          .object({
            sectionEntityIds: z.array(sketchEntityIdSchema).min(2).max(24),
            sectionStartPointIds: z.array(sketchEntityIdSchema).min(2).max(24),
          })
          .strict(),
      )
      .min(3)
      .max(64),
    rails: z
      .array(z.object({ vertexTrack: trackIndex, path: sketchPathSelectorSchema }).strict())
      .max(64),
    guides: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(128),
            segmentTrack: trackIndex,
            continuity: z.literal("C0"),
            path: sketchPathSelectorSchema,
          })
          .strict(),
      )
      .max(64),
    start: z.array(endConstraint).max(64),
    end: z.array(endConstraint).max(64),
  })
  .strict()
  .superRefine((parameters, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message })
    if (
      new Set(parameters.sections.map(sketchProfileSelectorKey)).size !== parameters.sections.length
    )
      issue("Loft sections must be unique.")
    validateCorrespondence(parameters, issue)
    validateConstraints(parameters, issue)
    const entities =
      parameters.sections.reduce((n, s) => n + s.outerBoundaryEntityIds.length, 0) +
      [...parameters.rails, ...parameters.guides].reduce(
        (n, entry) => n + entry.path.entityIds.length,
        0,
      )
    if (entities > 2_000) issue("Constrained Loft exceeds the aggregate curve budget.")
  })
export type LoftFeatureParametersV3 = z.infer<typeof loftFeatureParametersV3Schema>
function validateCorrespondence(
  parameters: LoftFeatureParametersV3,
  issue: (message: string) => void,
) {
  const { sections, outerCorrespondence: tracks } = parameters
  if (
    tracks.some(
      (track) =>
        track.sectionEntityIds.length !== sections.length ||
        track.sectionStartPointIds.length !== sections.length,
    )
  )
    issue("Loft correspondence must cover every ordered section.")
  for (const [column, section] of sections.entries()) {
    const actual = tracks.map((track) => track.sectionEntityIds[column])
    if (
      section.holeBoundaryEntityIds.length ||
      actual.length !== section.outerBoundaryEntityIds.length ||
      new Set(actual).size !== actual.length ||
      actual.some((id) => !id || !section.outerBoundaryEntityIds.includes(id))
    )
      issue("Constrained Loft requires exactly matched hole-free outer topology.")
  }
}
function validateConstraints(
  parameters: LoftFeatureParametersV3,
  issue: (message: string) => void,
) {
  const count = parameters.outerCorrespondence.length
  const trackSets = [
    parameters.rails.map((r) => r.vertexTrack),
    parameters.start.map((e) => e.segmentTrack),
    parameters.end.map((e) => e.segmentTrack),
  ]
  for (const tracks of trackSets)
    if (new Set(tracks).size !== tracks.length || tracks.some((track) => track >= count))
      issue("Loft rails and end constraints require unique existing tracks.")
  if (
    new Set(parameters.guides.map((g) => g.name)).size !== parameters.guides.length ||
    parameters.guides.some((g) => g.segmentTrack >= count)
  )
    issue("Loft guides require unique names and existing segment tracks.")
  const roles = new Map<string, string>()
  for (const { support } of [...parameters.start, ...parameters.end]) {
    const role = roles.get(support.featureId)
    if (role !== undefined && role !== support.outputRole)
      issue("One Loft producer cannot select multiple body roles.")
    roles.set(support.featureId, support.outputRole)
  }
}
export function loftV3SketchIds(parameters: LoftFeatureParametersV3) {
  return [
    ...new Set([
      ...parameters.sections.map((s) => s.sketchId),
      ...parameters.rails.map((r) => r.path.sketchId),
      ...parameters.guides.map((g) => g.path.sketchId),
    ]),
  ]
}
export function loftV3SupportBodies(parameters: LoftFeatureParametersV3) {
  return [
    ...new Map(
      [...parameters.start, ...parameters.end].map(({ support }) => [
        support.featureId,
        { featureId: support.featureId, outputRole: support.outputRole },
      ]),
    ).values(),
  ]
}
export const loftFeatureTypeV3 = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.loft",
    schemaVersion: 3,
  },
  classification: "solid",
  dependencies: { min: 0, max: MAX_LOFT_V3_DEPENDENCIES },
  references: { min: 0, max: 4_096 },
})
export function readLoftFeatureParametersV3(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): LoftFeatureParametersV3 | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(loftFeatureTypeV3.type)) return null
  const parsed = loftFeatureParametersV3Schema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
export const loftFeatureTypeHandlerV3: TrustedFeatureTypeHandler = {
  type: loftFeatureTypeV3.type,
  parametersSchema: loftFeatureParametersV3Schema,
  validateFeature(feature) {
    const parameters = loftFeatureParametersV3Schema.parse(feature.parameters)
    return [
      ...loftV3SupportBodies(parameters).map(({ featureId }) => featureId),
      ...feature.references.map(({ featureId }) => featureId),
    ].some((id) => !feature.dependencies.includes(id))
      ? [{ path: "dependencies", message: "Loft support owners must be scheduled dependencies." }]
      : []
  },
  contentParameters(parameters) {
    return loftFeatureParametersV3Schema.parse(parameters)
  },
}
