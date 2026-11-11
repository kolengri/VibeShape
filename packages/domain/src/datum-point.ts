import { z } from "zod"
import { bodyTopoRefSchema, bodyVertexRefSchema } from "./body-topology-reference"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"
import { lengthQuantitySchema } from "./units"
import {
  type EvaluatedVariable,
  type ExpressionValue,
  resolveQuantityExpression,
} from "./variables"

const MAX_DATUM_POINT_COORDINATE_MM = 100_000

const datumPointCoordinateSchema = lengthQuantitySchema.refine(
  ({ value }) => Math.abs(value) <= MAX_DATUM_POINT_COORDINATE_MM,
  `Datum point coordinates must be at most ${MAX_DATUM_POINT_COORDINATE_MM} mm from the origin.`,
)

/** A circular (full circle or arc) edge whose analytical center locates the point. */
export const datumPointCircleEdgeRefSchema = bodyTopoRefSchema.refine(
  ({ kind, signature }) => kind === "edge" && signature.geometryClass === "CIRCLE",
  "A circle-center datum point requires a stable circular edge reference.",
)

/**
 * Datum Point v1. Coordinates are model millimeters with expressions; vertex and circle-center
 * modes persist only body-bound semantic references and resolve them on every rebuild.
 */
export const datumPointParametersSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("coordinates"),
      position: z
        .object({
          x: datumPointCoordinateSchema,
          y: datumPointCoordinateSchema,
          z: datumPointCoordinateSchema,
        })
        .strict(),
    })
    .strict(),
  z.object({ mode: z.literal("vertex"), reference: bodyVertexRefSchema }).strict(),
  z.object({ mode: z.literal("circle-center"), reference: datumPointCircleEdgeRefSchema }).strict(),
])
export type DatumPointParameters = Readonly<z.infer<typeof datumPointParametersSchema>>

export const datumPointFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.reference-geometry",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.reference-geometry.datum-point",
    schemaVersion: 1,
  },
  classification: "reference",
  dependencies: { min: 0, max: 1 },
  references: { min: 0, max: 0 },
})

/** The feature whose body owns the point reference, or null for explicit coordinates. */
export function datumPointSupportFeatureId(parameters: DatumPointParameters) {
  return parameters.mode === "coordinates" ? null : parameters.reference.featureId
}

function datumPointInvariant(feature: FeatureRecord) {
  const parsed = datumPointParametersSchema.safeParse(feature.parameters)
  if (!parsed.success) return []
  const owner = datumPointSupportFeatureId(parsed.data)
  const valid =
    feature.references.length === 0 &&
    (owner === null
      ? feature.dependencies.length === 0
      : feature.dependencies.length === 1 && feature.dependencies[0] === owner)
  return valid
    ? []
    : [
        {
          path: "dependencies",
          message:
            "A datum point depends only on the producer of its body-bound reference, with topology stored in parameters.",
        },
      ]
}

type VariableValues = ReadonlyMap<string, ExpressionValue | EvaluatedVariable>

function resolveCoordinate(
  axis: "x" | "y" | "z",
  quantity: z.infer<typeof lengthQuantitySchema>,
  variables: VariableValues,
) {
  const path = `position.${axis}`
  const resolved = resolveQuantityExpression(quantity, variables)
  if (!resolved.ok)
    return {
      ok: false as const,
      diagnostic: {
        code: resolved.diagnostic.code,
        message: "A datum point coordinate expression is invalid.",
        issues: [{ path, message: resolved.diagnostic.message }],
      },
    }
  const coordinate = datumPointCoordinateSchema.safeParse(resolved.quantity)
  return coordinate.success
    ? { ok: true as const, quantity: coordinate.data }
    : {
        ok: false as const,
        diagnostic: {
          code: "invalid-datum-point-coordinate",
          message: "A datum point coordinate must resolve to a bounded length.",
          issues: [{ path, message: coordinate.error.issues[0]?.message ?? "Invalid length." }],
        },
      }
}

function resolveDatumPointParameters(parameters: unknown, variables: VariableValues) {
  const parsed = datumPointParametersSchema.safeParse(parameters)
  if (!parsed.success || parsed.data.mode !== "coordinates")
    return { ok: true as const, parameters }
  const position: Record<"x" | "y" | "z", z.infer<typeof lengthQuantitySchema>> = {
    ...parsed.data.position,
  }
  for (const axis of ["x", "y", "z"] as const) {
    const resolved = resolveCoordinate(axis, parsed.data.position[axis], variables)
    if (!resolved.ok) return resolved
    position[axis] = resolved.quantity
  }
  return { ok: true as const, parameters: { mode: "coordinates" as const, position } }
}

function datumPointContentParameters(parameters: unknown) {
  const datum = datumPointParametersSchema.parse(parameters)
  if (datum.mode !== "coordinates") return { mode: datum.mode, reference: datum.reference }
  const { x, y, z } = datum.position
  return { mode: datum.mode, position: [x.value, y.value, z.value] }
}

export const datumPointFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: datumPointFeatureType.type,
  parametersSchema: datumPointParametersSchema,
  resolveParameters: resolveDatumPointParameters,
  contentParameters: datumPointContentParameters,
  validateFeature: datumPointInvariant,
}

export function isDatumPointFeatureType(type: FeatureRecord["type"]) {
  const expected = datumPointFeatureType.type
  return (
    type.moduleId === expected.moduleId &&
    type.moduleVersion === expected.moduleVersion &&
    type.typeId === expected.typeId &&
    type.schemaVersion === expected.schemaVersion
  )
}

export function readDatumPointFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
): DatumPointParameters | null {
  if (!isDatumPointFeatureType(feature.type)) return null
  const parsed = datumPointParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}

/** Complete dependency model for a parsed datum point; mirrors the registered invariant. */
export function hasCompleteDatumPointDependencyModel(feature: FeatureRecord) {
  return (
    readDatumPointFeatureParameters(feature) !== null && datumPointInvariant(feature).length === 0
  )
}
