import { featureIdSchema, variableIdSchema } from "@vibeshape/domain"
import messages from "../../i18n/messages/en.json"
import type { PatternFormCopy } from "./pattern-form"
import type { PatternFormMode } from "./pattern-form-model"

export const targetId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7901")
export const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7902")
export const mode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "pattern.instance.2" },
  createFeatureId: () => featureId,
  featureLabel: "Pattern 1",
} satisfies PatternFormMode
export const units = { length: "mm", angle: "deg" } as const
export const countVariable = {
  schemaVersion: 0 as const,
  id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7903"),
  name: "instances",
  expression: "4",
}
export const copy: PatternFormCopy = {
  ...messages.app.bodyPattern,
  submit: messages.app.bodyPattern.create,
}
