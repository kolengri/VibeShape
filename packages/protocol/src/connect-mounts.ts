import { z } from "zod"

// Exact extents reserve clearance for OCCT tolerance in the bounded result protocol.
const MAX_EXTENT_MM = 99_999.999

const coordinate = z.number().finite().min(-100_000).max(100_000)
const point = z.tuple([coordinate, coordinate, coordinate])
const radius = z.number().finite().min(0.001).max(100_000)

const connectMountsFeatureParametersSchema = z
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

export type ConnectMountsFeatureContentParameters = z.infer<
  typeof connectMountsFeatureContentParametersSchema
>
