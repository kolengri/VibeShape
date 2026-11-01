import { z } from "zod"
import type { FeatureRecord } from "./feature-graph"
import { featureTypeDescriptorSchema, featureTypeKey } from "./feature-type-contracts"
import type { TrustedFeatureTypeHandler } from "./feature-type-registry"

// Exact extents reserve clearance for OCCT tolerance in the bounded result protocol.
const MAX_EXTENT_MM = 99_999.999

const coordinate = z.number().finite().min(-100_000).max(100_000)
const point = z.tuple([coordinate, coordinate, coordinate])
const radius = z.number().finite().min(0.001).max(100_000)

export const connectMountsFeatureParametersSchema = z
  .object({
    points: z.array(point).min(2).max(16),
    nodeRadius: radius,
    strutRadius: radius,
    connectionMode: z.enum(["tree", "complete"]).default("tree"),
  })
  .strict()
  .superRefine(({ points, nodeRadius, strutRadius }, context) => {
    if (strutRadius > nodeRadius)
      context.addIssue({
        code: "custom",
        path: ["strutRadius"],
        message: "Strut radius must not exceed node radius.",
      })
    for (const [index, current] of points.entries()) {
      if (current.some((value) => Math.abs(value) + nodeRadius > MAX_EXTENT_MM))
        context.addIssue({
          code: "custom",
          path: ["points", index],
          message: "Mount nodes must remain at least 0.001 mm inside the 100000 mm workspace.",
        })
      for (const previous of points.slice(0, index)) {
        if (Math.hypot(...current.map((value, axis) => value - (previous[axis] ?? 0))) < 0.001)
          context.addIssue({
            code: "custom",
            path: ["points", index],
            message: "Mount points must be at least 0.001 mm apart.",
          })
      }
    }
  })

export const connectMountsFeatureContentParametersSchema = connectMountsFeatureParametersSchema

export type ConnectMountsFeatureParameters = z.infer<typeof connectMountsFeatureParametersSchema>
export type ConnectMountsFeatureContentParameters = z.infer<
  typeof connectMountsFeatureContentParametersSchema
>

export const connectMountsFeatureType = featureTypeDescriptorSchema.parse({
  schemaVersion: 0,
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.connect-mounts",
    schemaVersion: 1,
  },
  classification: "solid",
  dependencies: { min: 0, max: 0 },
  references: { min: 0, max: 0 },
})

export const connectMountsFeatureTypeHandler: TrustedFeatureTypeHandler = {
  type: connectMountsFeatureType.type,
  parametersSchema: connectMountsFeatureParametersSchema,
  contentParameters(parameters) {
    const parsed = connectMountsFeatureParametersSchema.parse(parameters)
    const points = parsed.points.map(([x, y, z]): [number, number, number] => [
      x === 0 ? 0 : x,
      y === 0 ? 0 : y,
      z === 0 ? 0 : z,
    ])
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    return { ...parsed, points }
  },
}

export function readConnectMountsFeatureParameters(
  feature: Pick<FeatureRecord, "type" | "parameters">,
) {
  if (featureTypeKey(feature.type) !== featureTypeKey(connectMountsFeatureType.type)) return null
  const parsed = connectMountsFeatureParametersSchema.safeParse(feature.parameters)
  return parsed.success ? parsed.data : null
}
