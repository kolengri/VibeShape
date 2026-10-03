import { featureIdSchema, variableIdSchema } from "@vibeshape/domain"
import messages from "../../i18n/messages/en.json"
import type { ThreadFormCopy } from "./thread-form"
import type { ThreadFormMode } from "./thread-form-model"
export const targetId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f8001")
export const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f8002")
export const mode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "pattern.instance.2" },
  createFeatureId: () => featureId,
  featureLabel: "Thread 1",
} satisfies ThreadFormMode
export const units = { length: "mm", angle: "deg" } as const
export const pitchVariable = {
  schemaVersion: 0 as const,
  id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f8003"),
  name: "step",
  expression: "2 mm",
}
export const copy: ThreadFormCopy = { ...messages.app.thread, submit: messages.app.thread.create }
