import { z } from "zod"
import { bodyReferenceSchema } from "./body-reference"
import {
  type BodyFaceRef,
  bodyFaceRefSchema,
  bodyTopoRefIdentityKeys,
} from "./body-topology-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { referenceFrameInvariant, referencePlaneSchema } from "./reference-frame"
import { angleQuantitySchema } from "./units"
import { resolveQuantityExpression } from "./variables"

export const DRAFT_MAX_FACES = 256
/** Inclusive lower bound; OCCT silently leaves faces untouched at or below 1e-4 rad (~0.0057°). */
export const DRAFT_MIN_ANGLE_RADIANS = (0.01 * Math.PI) / 180
/** Exclusive upper bound; OCCT draft geometry degenerates as the angle approaches 90 degrees. */
export const DRAFT_MAX_ANGLE_RADIANS = (89 * Math.PI) / 180

export const draftAngleSchema = angleQuantitySchema.refine(
  ({ value }) => value >= DRAFT_MIN_ANGLE_RADIANS && value < DRAFT_MAX_ANGLE_RADIANS,
  "Draft angle must be at least 0.01 degrees and less than 89 degrees.",
)

/** Content identity excludes document UUIDs; the dependency slot owns the body identity. */
export function draftContentFace({ featureId: _featureId, ...reference }: BodyFaceRef) {
  return reference
}

export const draftFeatureParametersSchema = z
  .object({
    targetBody: bodyReferenceSchema,
    faces: z.array(bodyFaceRefSchema).min(1).max(DRAFT_MAX_FACES),
    neutralPlane: referencePlaneSchema,
    angle: draftAngleSchema,
    /** Reverses the pull direction, which inverts the taper. */
    flip: z.boolean(),
  })
  .strict()
  .superRefine((parameters, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message })
    const ownedByTarget = (reference: BodyFaceRef) =>
      reference.featureId === parameters.targetBody.featureId &&
      reference.outputRole === parameters.targetBody.outputRole
    const neutral =
      parameters.neutralPlane.kind === "planar-face" ? parameters.neutralPlane.reference : null
    if (neutral && !ownedByTarget(neutral))
      issue(["neutralPlane", "reference"], "A Draft neutral face must belong to the target body.")
    const neutralKeys = new Set(neutral ? bodyTopoRefIdentityKeys(neutral) : [])
    const seen = new Set<string>()
    parameters.faces.forEach((face, index) => {
      if (!ownedByTarget(face))
        issue(["faces", index], "Draft faces must belong to the exact target body.")
      const keys = bodyTopoRefIdentityKeys(face)
      if (keys.some((key) => seen.has(key))) issue(["faces", index], "Draft faces must be unique.")
      if (keys.some((key) => neutralKeys.has(key)))
        issue(["faces", index], "The neutral plane face cannot also be drafted.")
      for (const key of keys) seen.add(key)
    })
  })
export type DraftFeatureParameters = Readonly<z.infer<typeof draftFeatureParametersSchema>>

export const draftFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.draft",
    schemaVersion: 1,
  },
  classification: "solid",
  // The target body, optionally followed by a Datum Plane that supplies the neutral plane.
  dependencies: { min: 1, max: 2 },
  references: { min: 0, max: 0 },
})

export function readDraftFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): DraftFeatureParameters | null {
  if (featureTypeKey(feature.type) !== featureTypeKey(draftFeatureType.type)) return null
  const parsed = draftFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

export const draftFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: draftFeatureType.type,
  parametersSchema: draftFeatureParametersSchema,
  resolveParameters(parameters, variables) {
    const parsed = draftFeatureParametersSchema.safeParse(parameters)
    if (!parsed.success) return { ok: true, parameters }
    const expression = resolveQuantityExpression(parsed.data.angle, variables)
    const angle = expression.ok ? draftAngleSchema.safeParse(expression.quantity) : null
    if (!expression.ok || !angle?.success)
      return {
        ok: false,
        diagnostic: {
          code: expression.ok ? "invalid-draft-angle" : expression.diagnostic.code,
          message: "The Draft angle expression is invalid.",
          issues: [
            {
              path: "angle",
              message: expression.ok
                ? "The angle must resolve to more than 0 and less than 89 degrees."
                : expression.diagnostic.message,
            },
          ],
        },
      }
    return { ok: true, parameters: { ...parsed.data, angle: angle.data } }
  },
  validateFeature(feature) {
    const { targetBody, neutralPlane } = draftFeatureParametersSchema.parse(feature.parameters)
    return referenceFrameInvariant(feature, targetBody.featureId, neutralPlane)
  },
  contentParameters(parameters) {
    // Worker content is prepared from the resolved neutral plane; this is the semantic fallback.
    const { faces, neutralPlane, angle, flip } = draftFeatureParametersSchema.parse(parameters)
    return {
      faces: faces.map(draftContentFace),
      neutralPlane:
        neutralPlane.kind === "planar-face"
          ? { kind: "planar-face", reference: draftContentFace(neutralPlane.reference) }
          : neutralPlane,
      angle: angle.value,
      flip,
    }
  },
}
