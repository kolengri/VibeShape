import { isFunction } from "is-what"
import type { z } from "zod"
import {
  type FeatureParameters,
  type FeatureRecord,
  featureParametersSchema,
  featureRecordSchema,
  featureTypeSchema,
} from "./feature-graph"
import {
  type FeatureTypeDescriptor,
  type FeatureTypeIdentity,
  featureTypeKey,
} from "./feature-type-contracts"
import type { ModuleRegistry } from "./modules"
import type { EvaluatedVariable, ExpressionValue } from "./variables"

export type FeatureParameterResolution =
  | { ok: true; parameters: unknown }
  | {
      ok: false
      diagnostic: Readonly<{
        code: string
        message: string
        issues: readonly { path: string; message: string }[]
      }>
    }

export type TrustedFeatureTypeHandler = Readonly<{
  type: FeatureTypeIdentity
  parametersSchema: z.ZodType
  contentParameters: (parameters: FeatureParameters) => unknown
  validateFeature?: (
    feature: FeatureRecord,
  ) => readonly Readonly<{ path: string; message: string }>[]
  resolveParameters?: (
    parameters: FeatureParameters,
    variables: ReadonlyMap<string, ExpressionValue | EvaluatedVariable>,
  ) => FeatureParameterResolution
}>

export type FeatureParameterResolutionResult =
  | { ok: true; feature: FeatureRecord }
  | {
      ok: false
      diagnostic: Readonly<{
        code: "invalid-feature-expression"
        reason: string
        message: string
        issues: readonly { path: string; message: string }[]
      }>
    }

export type FeatureTypeRegistryDiagnostic = Readonly<{
  code:
    | "invalid-feature-type-handler"
    | "duplicate-feature-type-handler"
    | "orphan-feature-type-handler"
    | "missing-feature-type-handler"
  message: string
}>

export type FeatureValidationDiagnostic = Readonly<{
  code:
    | "invalid-feature"
    | "feature-type-unavailable"
    | "invalid-feature-parameters"
    | "invalid-feature-content-parameters"
    | "invalid-feature-dependency-count"
    | "invalid-feature-reference-count"
  message: string
  issues: readonly { path: string; message: string }[]
}>

export type FeatureValidationResult =
  | {
      ok: true
      feature: FeatureRecord
      descriptor: FeatureTypeDescriptor
      contentParameters: FeatureParameters
    }
  | { ok: false; diagnostic: FeatureValidationDiagnostic }

export type FeatureTypeRegistry = Readonly<{
  descriptors: readonly FeatureTypeDescriptor[]
  getDescriptor: (type: FeatureTypeIdentity) => FeatureTypeDescriptor | undefined
  validateFeature: (input: unknown) => FeatureValidationResult
  resolveFeatureParameters: (
    input: unknown,
    variables: ReadonlyMap<string, ExpressionValue | EvaluatedVariable>,
  ) => FeatureParameterResolutionResult
}>

export type FeatureTypeRegistryResult =
  | { ok: true; registry: FeatureTypeRegistry }
  | { ok: false; diagnostic: FeatureTypeRegistryDiagnostic }

function registryFailure(
  code: FeatureTypeRegistryDiagnostic["code"],
  message: string,
): Extract<FeatureTypeRegistryResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message } }
}

function validationFailure(
  code: FeatureValidationDiagnostic["code"],
  message: string,
  issues: FeatureValidationDiagnostic["issues"] = [],
): Extract<FeatureValidationResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, issues: issues.slice(0, 8) } }
}

function zodIssues(error: z.ZodError, prefix = "") {
  return error.issues.slice(0, 8).map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join("."),
    message: issue.message,
  }))
}

function hasValidTrustedHandlerMethods(handler: TrustedFeatureTypeHandler) {
  return (
    isFunction(handler.parametersSchema?.safeParse) &&
    isFunction(handler.contentParameters) &&
    (handler.validateFeature === undefined || isFunction(handler.validateFeature))
  )
}

function indexHandlers(
  moduleRegistry: ModuleRegistry,
  handlers: readonly TrustedFeatureTypeHandler[],
) {
  const handlersByKey = new Map<string, TrustedFeatureTypeHandler>()

  for (const handler of handlers) {
    const parsedType = featureTypeSchema.safeParse(handler.type)
    if (!parsedType.success || !hasValidTrustedHandlerMethods(handler)) {
      return registryFailure(
        "invalid-feature-type-handler",
        "A trusted feature type handler is invalid.",
      )
    }

    const key = featureTypeKey(parsedType.data)
    if (handlersByKey.has(key)) {
      return registryFailure(
        "duplicate-feature-type-handler",
        `Feature type handler ${key} is registered twice.`,
      )
    }
    if (!moduleRegistry.getFeatureType(parsedType.data)) {
      return registryFailure(
        "orphan-feature-type-handler",
        `Feature type handler ${key} has no registered descriptor.`,
      )
    }

    handlersByKey.set(key, handler)
  }

  const missing = moduleRegistry.featureTypes.find(
    (descriptor) => !handlersByKey.has(featureTypeKey(descriptor.type)),
  )

  return missing
    ? registryFailure(
        "missing-feature-type-handler",
        `Feature type ${featureTypeKey(missing.type)} has no trusted handler.`,
      )
    : ({ ok: true, handlersByKey } as const)
}

function withinCardinality(count: number, cardinality: { min: number; max: number }) {
  return count >= cardinality.min && count <= cardinality.max
}

function validateCardinality(
  feature: FeatureRecord,
  descriptor: FeatureTypeDescriptor,
): FeatureValidationResult | null {
  if (!withinCardinality(feature.dependencies.length, descriptor.dependencies)) {
    return validationFailure(
      "invalid-feature-dependency-count",
      `Feature ${feature.id} has an invalid dependency count for ${descriptor.type.typeId}.`,
    )
  }
  if (!withinCardinality(feature.references.length, descriptor.references)) {
    return validationFailure(
      "invalid-feature-reference-count",
      `Feature ${feature.id} has an invalid topology reference count for ${descriptor.type.typeId}.`,
    )
  }
  return null
}

function normalizedParameters(
  handler: TrustedFeatureTypeHandler,
  input: FeatureParameters,
):
  | { ok: true; parameters: FeatureParameters }
  | { ok: false; diagnostic: FeatureValidationDiagnostic } {
  let parsed: ReturnType<typeof handler.parametersSchema.safeParse>

  try {
    parsed = handler.parametersSchema.safeParse(input)
  } catch {
    return validationFailure(
      "invalid-feature-parameters",
      "The trusted feature parameter normalizer failed.",
    )
  }

  if (!parsed.success) {
    return validationFailure(
      "invalid-feature-parameters",
      "The feature parameters do not match the registered feature type schema.",
      zodIssues(parsed.error, "parameters"),
    )
  }

  const json = featureParametersSchema.safeParse(parsed.data)
  return json.success
    ? { ok: true, parameters: json.data }
    : validationFailure(
        "invalid-feature-parameters",
        "The feature parameter normalizer returned a non-JSON or oversized object.",
        zodIssues(json.error, "parameters"),
      )
}

function validateFeatureInvariants(
  handler: TrustedFeatureTypeHandler,
  feature: FeatureRecord,
): FeatureValidationResult | null {
  if (!handler.validateFeature) return null

  try {
    const issues = handler.validateFeature(feature).slice(0, 8)
    return issues.length === 0
      ? null
      : validationFailure(
          "invalid-feature-parameters",
          "The feature record violates a registered feature invariant.",
          issues,
        )
  } catch {
    return validationFailure(
      "invalid-feature-parameters",
      "The trusted feature invariant validator failed.",
    )
  }
}

function normalizedContentParameters(
  handler: TrustedFeatureTypeHandler,
  parameters: FeatureParameters,
):
  | { ok: true; contentParameters: FeatureParameters }
  | { ok: false; diagnostic: FeatureValidationDiagnostic } {
  let contentParameters: unknown

  try {
    contentParameters = handler.contentParameters(parameters)
  } catch {
    return validationFailure(
      "invalid-feature-content-parameters",
      "The trusted feature content normalizer failed.",
    )
  }

  const parsed = featureParametersSchema.safeParse(contentParameters)
  return parsed.success
    ? { ok: true, contentParameters: parsed.data }
    : validationFailure(
        "invalid-feature-content-parameters",
        "The feature content normalizer returned a non-JSON or oversized object.",
        zodIssues(parsed.error, "parameters"),
      )
}

function validateRegisteredFeature(
  moduleRegistry: ModuleRegistry,
  handlersByKey: ReadonlyMap<string, TrustedFeatureTypeHandler>,
  input: unknown,
): FeatureValidationResult {
  const parsed = featureRecordSchema.safeParse(input)
  if (!parsed.success) {
    return validationFailure(
      "invalid-feature",
      "The feature record is invalid.",
      zodIssues(parsed.error),
    )
  }

  const descriptor = moduleRegistry.getFeatureType(parsed.data.type)
  const handler = handlersByKey.get(featureTypeKey(parsed.data.type))
  if (!descriptor || !handler) {
    return validationFailure(
      "feature-type-unavailable",
      `Feature type ${featureTypeKey(parsed.data.type)} is unavailable.`,
    )
  }

  const cardinality = validateCardinality(parsed.data, descriptor)
  if (cardinality) return cardinality

  const parameters = normalizedParameters(handler, parsed.data.parameters)
  if (!parameters.ok) return parameters

  const feature = { ...parsed.data, parameters: parameters.parameters }
  const invariant = validateFeatureInvariants(handler, feature)
  if (invariant) return invariant
  const contentParameters = normalizedContentParameters(handler, feature.parameters)
  return contentParameters.ok
    ? { ok: true, feature, descriptor, contentParameters: contentParameters.contentParameters }
    : contentParameters
}

function resolveFeatureParameters(
  handlersByKey: ReadonlyMap<string, TrustedFeatureTypeHandler>,
  input: unknown,
  variables: ReadonlyMap<string, ExpressionValue | EvaluatedVariable>,
): FeatureParameterResolutionResult {
  const feature = featureRecordSchema.safeParse(input)
  if (!feature.success) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid-feature-expression",
        reason: "invalid-feature-record",
        message: "The feature record cannot be resolved.",
        issues: zodIssues(feature.error),
      },
    }
  }
  const handler = handlersByKey.get(featureTypeKey(feature.data.type))
  if (!handler?.resolveParameters) return { ok: true, feature: feature.data }

  let resolved: FeatureParameterResolution
  try {
    resolved = handler.resolveParameters(feature.data.parameters, variables)
  } catch {
    return {
      ok: false,
      diagnostic: {
        code: "invalid-feature-expression",
        reason: "resolver-failed",
        message: "The trusted feature expression resolver failed.",
        issues: [],
      },
    }
  }
  if (!resolved.ok) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid-feature-expression",
        reason: resolved.diagnostic.code,
        message: resolved.diagnostic.message,
        issues: resolved.diagnostic.issues.slice(0, 8).map((issue) => ({
          path: ["parameters", issue.path].filter(Boolean).join("."),
          message: issue.message,
        })),
      },
    }
  }
  const parameters = featureParametersSchema.safeParse(resolved.parameters)
  return parameters.success
    ? { ok: true, feature: { ...feature.data, parameters: parameters.data } }
    : {
        ok: false,
        diagnostic: {
          code: "invalid-feature-expression",
          reason: "invalid-resolved-parameters",
          message: "The feature expression resolver returned invalid parameters.",
          issues: zodIssues(parameters.error, "parameters"),
        },
      }
}

export function createFeatureTypeRegistry(
  moduleRegistry: ModuleRegistry,
  handlers: readonly TrustedFeatureTypeHandler[],
): FeatureTypeRegistryResult {
  const indexed = indexHandlers(moduleRegistry, handlers)

  return indexed.ok
    ? {
        ok: true,
        registry: {
          descriptors: moduleRegistry.featureTypes,
          getDescriptor: (type) => moduleRegistry.getFeatureType(type),
          validateFeature: (input) =>
            validateRegisteredFeature(moduleRegistry, indexed.handlersByKey, input),
          resolveFeatureParameters: (input, variables) =>
            resolveFeatureParameters(indexed.handlersByKey, input, variables),
        },
      }
    : indexed
}
