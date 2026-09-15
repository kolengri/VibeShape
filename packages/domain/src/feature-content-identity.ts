import { z } from "zod"
import { bodyOutputRoleSchema } from "./body-reference"
import { canonicalJson } from "./canonical-json"
import { featureBodyDependencies } from "./feature-dependencies"
import { featureParametersSchema, featureTypeSchema } from "./feature-graph"
import type { FeatureTypeRegistry } from "./feature-type-registry"
import { featureIdSchema, moduleVersionSchema, technicalIdentifierSchema } from "./identifiers"
import { topoRefContentSchema } from "./topology"

const MAX_DEPENDENCIES = 1_024
const MAX_REFERENCES = 4_096
const exactBuildVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((version) => version.trim() === version, "Build versions must be normalized.")
const sourceRevisionSchema = z
  .string()
  .regex(
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/,
    "Source revisions must be exact lowercase hexadecimal identifiers.",
  )
  .nullable()

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "Expected a SHA-256 digest.")

const builtInFeatureProviderSchema = z.object({ kind: z.literal("built-in") }).strict()

const extensionFeatureProviderSchema = z
  .object({
    kind: z.literal("extension"),
    extensionId: technicalIdentifierSchema,
    extensionVersion: moduleVersionSchema,
    apiVersion: moduleVersionSchema,
    integrity: sha256Schema,
  })
  .strict()

export const featureContentEnvironmentSchema = z
  .object({
    schemaVersion: z.literal(0),
    hostApiVersion: moduleVersionSchema,
    geometry: z
      .object({
        adapterId: technicalIdentifierSchema,
        adapterVersion: exactBuildVersionSchema,
        kernelId: technicalIdentifierSchema,
        kernelVersion: exactBuildVersionSchema,
        kernelSourceRevision: sourceRevisionSchema,
      })
      .strict(),
    modelingTolerancePolicyVersion: z.number().int().positive().safe(),
    provider: z.discriminatedUnion("kind", [
      builtInFeatureProviderSchema,
      extensionFeatureProviderSchema,
    ]),
  })
  .strict()

export const featureDependencyContentSchema = z
  .object({
    featureId: featureIdSchema,
    contentHash: sha256Schema,
    outputRole: bodyOutputRoleSchema.optional(),
  })
  .strict()

const contentReferenceSchema = topoRefContentSchema
  .safeExtend({
    inputIndex: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_DEPENDENCIES - 1),
  })
  .strict()

const legacyFeatureContentIdentitySchema = z
  .object({
    schemaVersion: z.literal(0),
    feature: z
      .object({
        schemaVersion: z.literal(0),
        type: featureTypeSchema,
        parameters: featureParametersSchema,
        inputs: z.array(sha256Schema).max(MAX_DEPENDENCIES),
        references: z.array(contentReferenceSchema).max(MAX_REFERENCES),
      })
      .strict(),
    environment: featureContentEnvironmentSchema,
  })
  .strict()

const namedFeatureContentIdentitySchema = legacyFeatureContentIdentitySchema.extend({
  schemaVersion: z.literal(1),
  feature: legacyFeatureContentIdentitySchema.shape.feature
    .extend({
      inputRoles: z
        .array(featureDependencyContentSchema.shape.outputRole.unwrap().nullable())
        .max(MAX_DEPENDENCIES),
    })
    .superRefine((feature, context) => {
      if (feature.inputRoles.length !== feature.inputs.length) {
        context.addIssue({
          code: "custom",
          path: ["inputRoles"],
          message: "Body roles must match the canonical input slots.",
        })
      }
      if (!feature.inputRoles.some((role) => role !== null)) {
        context.addIssue({
          code: "custom",
          path: ["inputRoles"],
          message: "Version 1 content must select at least one named body output.",
        })
      }
    }),
})

export const featureContentIdentitySchema = z.discriminatedUnion("schemaVersion", [
  legacyFeatureContentIdentitySchema,
  namedFeatureContentIdentitySchema,
])

export type FeatureContentEnvironment = Readonly<z.infer<typeof featureContentEnvironmentSchema>>
export type FeatureDependencyContent = Readonly<z.infer<typeof featureDependencyContentSchema>>
export type FeatureContentIdentity = Readonly<z.infer<typeof featureContentIdentitySchema>>

export type FeatureContentIdentityDiagnostic = Readonly<{
  code:
    | "invalid-feature-content"
    | "invalid-feature-content-environment"
    | "invalid-feature-dependency-content"
    | "duplicate-feature-dependency-content"
    | "missing-feature-dependency-content"
    | "unexpected-feature-dependency-content"
    | "feature-content-hash-failed"
    | "invalid-feature-content-hash"
  message: string
  issues: readonly { path: string; message: string }[]
}>

export type FeatureContentIdentityResult =
  | {
      ok: true
      identity: FeatureContentIdentity
      canonicalPayload: string
    }
  | { ok: false; diagnostic: FeatureContentIdentityDiagnostic }

export type FeatureContentHashResult =
  | {
      ok: true
      identity: FeatureContentIdentity
      canonicalPayload: string
      contentHash: string
    }
  | { ok: false; diagnostic: FeatureContentIdentityDiagnostic }

export type FeatureContentHasher = (canonicalPayload: string) => unknown | Promise<unknown>

export function serializeFeatureContentEnvironment(input: unknown) {
  return canonicalJson(featureContentEnvironmentSchema.parse(input))
}

export function serializeFeatureContentIdentity(input: unknown) {
  return canonicalJson(featureContentIdentitySchema.parse(input))
}

function diagnostic(
  code: FeatureContentIdentityDiagnostic["code"],
  message: string,
  issues: FeatureContentIdentityDiagnostic["issues"] = [],
): Extract<FeatureContentIdentityResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, issues: issues.slice(0, 8) } }
}

function zodIssues(error: z.ZodError, prefix: string) {
  return error.issues.slice(0, 8).map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join("."),
    message: issue.message,
  }))
}

function indexDependencyContent(dependencies: readonly FeatureDependencyContent[]):
  | {
      ok: true
      byFeatureId: ReadonlyMap<FeatureDependencyContent["featureId"], FeatureDependencyContent>
    }
  | { ok: false; diagnostic: FeatureContentIdentityDiagnostic } {
  const byFeatureId = new Map<FeatureDependencyContent["featureId"], FeatureDependencyContent>()

  for (const dependency of dependencies) {
    if (byFeatureId.has(dependency.featureId)) {
      return diagnostic(
        "duplicate-feature-dependency-content",
        `Dependency content for feature ${dependency.featureId} appears more than once.`,
      )
    }

    byFeatureId.set(dependency.featureId, dependency)
  }

  return { ok: true, byFeatureId }
}

function orderedInputContent(
  featureDependencies: readonly FeatureDependencyContent["featureId"][],
  byFeatureId: ReadonlyMap<FeatureDependencyContent["featureId"], FeatureDependencyContent>,
):
  | { ok: true; inputs: readonly string[]; inputRoles: readonly (string | null)[] }
  | { ok: false; diagnostic: FeatureContentIdentityDiagnostic } {
  const missing = featureDependencies.find((featureId) => !byFeatureId.has(featureId))

  if (missing) {
    return diagnostic(
      "missing-feature-dependency-content",
      `Feature dependency ${missing} has no content hash.`,
    )
  }

  if (byFeatureId.size !== featureDependencies.length) {
    return diagnostic(
      "unexpected-feature-dependency-content",
      "Dependency content contains a feature that is not declared by the feature record.",
    )
  }

  const ordered = featureDependencies.map(
    (featureId) => byFeatureId.get(featureId) as FeatureDependencyContent,
  )
  return {
    ok: true,
    inputs: ordered.map(({ contentHash }) => contentHash),
    inputRoles: ordered.map(({ outputRole }) => outputRole ?? null),
  }
}

export function createFeatureContentIdentity(
  registry: FeatureTypeRegistry,
  input: {
    feature: unknown
    dependencies: readonly unknown[]
    environment: unknown
    contentParameters?: unknown
  },
): FeatureContentIdentityResult {
  const validated = registry.validateFeature(input.feature)
  if (!validated.ok) {
    return diagnostic(
      "invalid-feature-content",
      validated.diagnostic.message,
      validated.diagnostic.issues,
    )
  }

  const environment = featureContentEnvironmentSchema.safeParse(input.environment)
  if (!environment.success) {
    return diagnostic(
      "invalid-feature-content-environment",
      "The feature content environment is invalid.",
      zodIssues(environment.error, "environment"),
    )
  }

  const dependencies = z
    .array(featureDependencyContentSchema)
    .max(MAX_DEPENDENCIES)
    .safeParse(input.dependencies)
  if (!dependencies.success) {
    return diagnostic(
      "invalid-feature-dependency-content",
      "Feature dependency content is invalid.",
      zodIssues(dependencies.error, "dependencies"),
    )
  }

  const indexed = indexDependencyContent(dependencies.data)
  if (!indexed.ok) return indexed
  const inputs = orderedInputContent(validated.feature.dependencies, indexed.byFeatureId)
  if (!inputs.ok) return inputs
  const mismatchedBody = featureBodyDependencies(validated.feature).find(
    ({ featureId, outputRole }) =>
      outputRole !== undefined && indexed.byFeatureId.get(featureId)?.outputRole !== outputRole,
  )
  if (mismatchedBody) {
    return diagnostic(
      "invalid-feature-dependency-content",
      "Dependency content must preserve the authored body selection.",
    )
  }

  const inputIndexes = new Map(
    validated.feature.dependencies.map((featureId, index) => [featureId, index]),
  )
  const references = validated.feature.references.map((reference) => {
    const { featureId, ...content } = reference
    return { ...content, inputIndex: inputIndexes.get(featureId) as number }
  })
  const contentParameters =
    input.contentParameters === undefined
      ? { success: true as const, data: validated.contentParameters }
      : featureParametersSchema.safeParse(input.contentParameters)
  if (!contentParameters.success) {
    return diagnostic(
      "invalid-feature-content",
      "Prepared feature content parameters are invalid.",
      zodIssues(contentParameters.error, "contentParameters"),
    )
  }
  const hasNamedInput = inputs.inputRoles.some((role) => role !== null)
  const identity = featureContentIdentitySchema.parse({
    schemaVersion: hasNamedInput ? 1 : 0,
    feature: {
      schemaVersion: validated.feature.schemaVersion,
      type: validated.feature.type,
      parameters: contentParameters.data,
      inputs: inputs.inputs,
      ...(hasNamedInput ? { inputRoles: inputs.inputRoles } : {}),
      references,
    },
    environment: environment.data,
  })

  return { ok: true, identity, canonicalPayload: serializeFeatureContentIdentity(identity) }
}

export async function computeFeatureContentHash(
  registry: FeatureTypeRegistry,
  input: {
    feature: unknown
    dependencies: readonly unknown[]
    environment: unknown
    contentParameters?: unknown
  },
  hash: FeatureContentHasher,
): Promise<FeatureContentHashResult> {
  const content = createFeatureContentIdentity(registry, input)
  if (!content.ok) return content

  let output: unknown
  try {
    output = await hash(content.canonicalPayload)
  } catch {
    return diagnostic("feature-content-hash-failed", "The feature content hash operation failed.")
  }

  const contentHash = sha256Schema.safeParse(output)
  return contentHash.success
    ? { ...content, contentHash: contentHash.data }
    : diagnostic(
        "invalid-feature-content-hash",
        "The feature content hash operation returned an invalid SHA-256 digest.",
      )
}
