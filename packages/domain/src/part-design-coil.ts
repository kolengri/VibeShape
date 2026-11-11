import { z } from "zod"
import { type BodyReference, bodyReferenceSchema } from "./body-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { FeatureParameterResolution, TrustedFeatureTypeHandler } from "./feature-type-registry"
import type { FeatureId } from "./identifiers"
import {
  addHelixExtentIssues,
  helixContentFields,
  helixFields,
  minimumHelixPitch,
  resolveHelixParameters,
  resolveHelixQuantity,
} from "./part-design-helix"
import {
  type ReferenceAxis,
  referenceFrameDependencyIds,
  referenceFrameSupportFeatureId,
} from "./reference-frame"
import { lengthQuantitySchema } from "./units"

export const coilSectionSizeSchema = lengthQuantitySchema.refine(
  ({ value }) => value >= 0.001 && value <= 10_000,
  "Coil section dimensions must be between 0.001 and 10,000 mm.",
)
export const coilSectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circular"), diameter: coilSectionSizeSchema }).strict(),
  z
    .object({
      kind: z.literal("rectangular"),
      /** Radial size, measured along the helix principal normal. */
      width: coilSectionSizeSchema,
      /** Axial size, measured along the helix binormal. */
      height: coilSectionSizeSchema,
    })
    .strict(),
])
export type CoilSection = Readonly<z.infer<typeof coilSectionSchema>>
export const coilOperationSchema = z.enum(["new", "add", "remove", "intersect"])

/** Radial and axial section sizes in the section plane normal to the helix start tangent. */
export function coilSectionSize(section: CoilSection) {
  return section.kind === "circular"
    ? { radial: section.diameter.value, axial: section.diameter.value }
    : { radial: section.width.value, axial: section.height.value }
}

export const coilFeatureParametersSchema = z
  .object({
    ...helixFields,
    section: coilSectionSchema,
    operation: coilOperationSchema,
    targetBody: bodyReferenceSchema.nullable(),
  })
  .strict()
  .superRefine((parameters, context) => {
    if ((parameters.operation === "new") !== (parameters.targetBody === null))
      context.addIssue({
        code: "custom",
        path: ["targetBody"],
        message:
          "New-body Coils use a null targetBody; Add, Remove and Intersect require one exact target body.",
      })
    addHelixExtentIssues(parameters, context)
    const size = coilSectionSize(parameters.section)
    if (size.radial / 2 >= parameters.radius.value)
      context.addIssue({
        code: "custom",
        path: ["section"],
        message:
          "The coil section must not reach the helix axis; reduce the section or increase the radius.",
      })
    const minimum = minimumHelixPitch(parameters.radius.value, size.axial)
    if (parameters.pitch.value <= minimum)
      context.addIssue({
        code: "custom",
        path: ["pitch"],
        message: Number.isFinite(minimum)
          ? `Adjacent coil turns would intersect. Increase the pitch above ${formatMillimeters(minimum)} mm or reduce the section height.`
          : "Adjacent coil turns would intersect at any pitch; increase the radius or reduce the section height.",
      })
  })
export type CoilFeatureParameters = Readonly<z.infer<typeof coilFeatureParametersSchema>>

function formatMillimeters(value: number) {
  return (Math.ceil(value * 1000) / 1000).toString()
}

export const coilFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.coil",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 2 },
  references: { min: 0, max: 0 },
})

export function readCoilFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): CoilFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(coilFeatureType.type)) return null
  return coilFeatureParametersSchema.safeParse(feature.parameters).data ?? null
}

/** Exact target first (when modifying), then any distinct axis producer. */
export function coilDependencyIds(
  parameters: Readonly<{ axis: ReferenceAxis; targetBody: BodyReference | null }>,
): readonly FeatureId[] {
  if (parameters.targetBody)
    return referenceFrameDependencyIds(parameters.targetBody.featureId, parameters.axis)
  const support = referenceFrameSupportFeatureId(parameters.axis)
  return support ? [support] : []
}

type Variables = Parameters<NonNullable<TrustedFeatureTypeHandler["resolveParameters"]>>[1]
function resolveSection(
  section: CoilSection,
  variables: Variables,
): { ok: true; section: CoilSection } | Extract<FeatureParameterResolution, { ok: false }> {
  if (section.kind === "circular") {
    const diameter = resolveHelixQuantity(
      section.diameter,
      coilSectionSizeSchema,
      "section.diameter",
      variables,
      "invalid-coil-parameter",
    )
    return diameter.ok
      ? { ok: true, section: { ...section, diameter: diameter.quantity } }
      : diameter
  }
  const width = resolveHelixQuantity(
    section.width,
    coilSectionSizeSchema,
    "section.width",
    variables,
    "invalid-coil-parameter",
  )
  if (!width.ok) return width
  const height = resolveHelixQuantity(
    section.height,
    coilSectionSizeSchema,
    "section.height",
    variables,
    "invalid-coil-parameter",
  )
  return height.ok
    ? { ok: true, section: { ...section, width: width.quantity, height: height.quantity } }
    : height
}

export const coilFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: coilFeatureType.type,
  parametersSchema: coilFeatureParametersSchema,
  resolveParameters(parameters, variables) {
    const parsed = coilFeatureParametersSchema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const helix = resolveHelixParameters(parsed.data, variables, "invalid-coil-parameter")
    if (!helix.ok) return helix
    const section = resolveSection(parsed.data.section, variables)
    if (!section.ok) return section
    const valid = coilFeatureParametersSchema.safeParse({
      ...helix.parameters,
      section: section.section,
    })
    return valid.success
      ? { ok: true, parameters: valid.data }
      : {
          ok: false,
          diagnostic: {
            code: "invalid-coil-geometry",
            message: "The resolved coil violates its geometry or resource bounds.",
            issues: valid.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        }
  },
  validateFeature(feature) {
    const value = coilFeatureParametersSchema.parse(feature.parameters)
    return JSON.stringify(feature.dependencies) === JSON.stringify(coilDependencyIds(value)) &&
      feature.references.length === 0
      ? []
      : [
          {
            path: "dependencies",
            message:
              "Coil requires its exact target first when modifying and any distinct axis producer, with no generic topology references.",
          },
        ]
  },
  contentParameters(parameters) {
    const value = coilFeatureParametersSchema.parse(parameters)
    return {
      ...helixContentFields(value),
      axis: value.axis,
      section:
        value.section.kind === "circular"
          ? { kind: "circular", diameter: value.section.diameter.value }
          : {
              kind: "rectangular",
              width: value.section.width.value,
              height: value.section.height.value,
            },
      operation: value.operation,
    }
  },
}
