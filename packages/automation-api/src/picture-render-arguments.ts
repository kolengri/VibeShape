import { revisionSchema } from "@vibeshape/domain/identifiers"
import {
  pictureRenderCameraSchema,
  pictureRenderSettingsSchema,
} from "@vibeshape/domain/picture-render"
import { z } from "zod"
export const preparePictureRenderArgumentsSchema = z
  .strictObject({
    revision: revisionSchema,
    settings: pictureRenderSettingsSchema.default(() => pictureRenderSettingsSchema.parse({})),
    camera: pictureRenderCameraSchema.optional(),
  })
  .refine(
    (v) => (v.settings.camera === "current") === (v.camera !== undefined),
    "Current framing requires an explicit camera pose; auto framing does not accept a pose.",
  )
