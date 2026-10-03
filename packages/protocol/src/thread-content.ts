import { z } from "zod"

export const THREAD_CONTENT_MAX_AUTHORED_TURNS = 16
const positiveLength = z.number().finite().positive().max(1000)
const nonnegativeLength = z.number().finite().min(0).max(1000)
export const threadContentParametersSchema = z
  .object({
    kind: z.enum(["external", "internal"]),
    axis: z.enum(["X", "Y", "Z"]),
    origin: z.tuple([
      z.number().finite().min(-100_000).max(100_000),
      z.number().finite().min(-100_000).max(100_000),
      z.number().finite().min(-100_000).max(100_000),
    ]),
    nominalDiameter: positiveLength,
    pitch: z.number().finite().min(0.2).max(20),
    length: positiveLength,
    depth: positiveLength,
    clearance: nonnegativeLength,
    handedness: z.enum(["right", "left"]),
    starts: z.number().int().min(1).max(4),
    phase: z
      .number()
      .finite()
      .min(-2 * Math.PI)
      .max(2 * Math.PI),
    runIn: nonnegativeLength,
    runOut: nonnegativeLength,
  })
  .strict()
  .superRefine((parameters, context) => {
    const band = parameters.length - parameters.runIn - parameters.runOut
    if (band <= 0)
      context.addIssue({
        code: "custom",
        path: ["length"],
        message: "The threaded band must have positive length.",
      })
    if (band / parameters.pitch > THREAD_CONTENT_MAX_AUTHORED_TURNS)
      context.addIssue({
        code: "custom",
        path: ["pitch"],
        message:
          "Modeled threads allow at most 16 total turns. Reduce the band length or increase the pitch.",
      })
    if (parameters.depth > 0.75 * parameters.pitch)
      context.addIssue({
        code: "custom",
        path: ["depth"],
        message: "Thread depth must not exceed 0.75 times the pitch.",
      })
    if (
      parameters.kind === "external" &&
      parameters.nominalDiameter / 2 - parameters.clearance - parameters.depth <= 0
    )
      context.addIssue({
        code: "custom",
        path: ["depth"],
        message: "External thread root radius must remain positive after radial clearance.",
      })
  })
export type ThreadContentParameters = Readonly<z.infer<typeof threadContentParametersSchema>>
