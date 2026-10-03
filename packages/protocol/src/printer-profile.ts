import { z } from "zod"

const dimension = z.number().finite().positive().max(100_000)

/** A rectangular build volume in millimeters, centered in XY with its bed at Z = 0. */
export const printerProfileSchema = z
  .strictObject({
    version: z.literal(1),
    name: z.string().trim().min(1).max(128),
    bedShape: z.literal("rectangular").default("rectangular"),
    width: dimension,
    depth: dimension,
    height: dimension,
    margin: z.number().finite().nonnegative().default(0),
  })
  .superRefine((profile, context) => {
    if (profile.margin * 2 >= Math.min(profile.width, profile.depth)) {
      context.addIssue({
        code: "custom",
        path: ["margin"],
        message: "The bed margin must leave a positive usable width and depth.",
      })
    }
  })

export type PrinterProfile = z.infer<typeof printerProfileSchema>
