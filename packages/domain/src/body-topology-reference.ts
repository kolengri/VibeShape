import { z } from "zod"
import { type BodyReference, bodyOutputRoleSchema } from "./body-reference"
import { canonicalJson } from "./canonical-json"
import { featureIdSchema } from "./identifiers"
import { topoRefContentSchema } from "./topology"

/** Stable references to one named body output; native candidate IDs never enter persistence. */
export const bodyTopoRefContentSchema = z
  .object({
    ...topoRefContentSchema.shape,
    schemaVersion: z.literal(1),
    outputRole: bodyOutputRoleSchema,
    kind: z.enum(["edge", "face"]),
  })
  .strict()
  .refine((reference) => reference.kind === reference.signature.kind, {
    message: "Body TopoRef kind must match its signature kind.",
    path: ["signature", "kind"],
  })
export const bodyTopoRefSchema = bodyTopoRefContentSchema.safeExtend({ featureId: featureIdSchema })
export const bodyFaceRefSchema = bodyTopoRefSchema.safeExtend({ kind: z.literal("face") })
export type BodyTopoRef = Readonly<z.infer<typeof bodyTopoRefSchema>>
export type BodyFaceRef = Readonly<z.infer<typeof bodyFaceRefSchema>>
export const bodyEdgeRefSchema = bodyTopoRefSchema.safeExtend({ kind: z.literal("edge") })

/** Durable identity keys used to reject duplicate body-bound targets within one feature. */
export function bodyTopoRefDurableKeys(reference: BodyTopoRef): string[] {
  const prefix = `${reference.kind}:${reference.outputRole}:`
  const keys = [
    reference.semanticRole && `${prefix}role:${reference.semanticRole}`,
    reference.lineageToken && `${prefix}lineage:${reference.lineageToken}`,
  ].filter((value) => value !== undefined)
  return keys.length ? keys : [canonicalJson(reference)]
}

type BodyTopoRefIssue = (path: (string | number)[], message: string) => void

/**
 * Shared ownership and distinctness checks for body-bound feature references. `owned` requires
 * the exact target body and output role; each `distinct` group also rejects a repeated durable
 * identity. Callers keep their own messages, so diagnostics stay feature-specific.
 */
export function bodyTopoRefChecks(
  targetBody: Pick<BodyReference, "featureId" | "outputRole">,
  ownerMessage: string,
  issue: BodyTopoRefIssue,
) {
  const owned = (reference: BodyTopoRef, path: (string | number)[]) => {
    if (
      reference.featureId !== targetBody.featureId ||
      reference.outputRole !== targetBody.outputRole
    )
      issue(path, ownerMessage)
  }
  const distinct = (message: string) => {
    const seen = new Set<string>()
    return (reference: BodyTopoRef, path: (string | number)[]) => {
      owned(reference, path)
      const keys = bodyTopoRefDurableKeys(reference)
      if (keys.some((key) => seen.has(key))) issue(path, message)
      for (const key of keys) seen.add(key)
    }
  }
  return { owned, distinct }
}

/** Content identity omits the owning feature ID; the dependency edge already binds it. */
export function bodyTopoRefContent<T extends BodyTopoRef>({
  featureId: _featureId,
  ...reference
}: T) {
  return reference
}
