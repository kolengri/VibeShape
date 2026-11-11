import {
  documentSnapshotSchema,
  featureIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import messages from "../../i18n/messages/en.json"
import type { PathSketchOption } from "../sweep-loft/sweep-loft-form-model"
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
  previewFailed: "The exact pattern could not be built.",
  pathPreviewFailed: "The exact path pattern could not be built.",
}

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7910")
const startId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7911")
const endId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7912")
export const lineId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7913")
export const pathSketch = sketchRecordSchema.parse({
  schemaVersion: 0,
  id: sketchId,
  label: "Rail",
  plane: "xy",
  entities: [
    { schemaVersion: 0, id: startId, type: "point", x: 0, y: 0, construction: false },
    { schemaVersion: 0, id: endId, type: "point", x: 100, y: 0, construction: false },
    {
      schemaVersion: 0,
      id: lineId,
      type: "line",
      startPointId: startId,
      endPointId: endId,
      construction: false,
    },
  ],
  constraints: [],
})
export const pathStartId = startId
export const paths: readonly PathSketchOption[] = [
  {
    sketch: pathSketch,
    curves: [{ id: lineId, label: "Line 3", startPointId: startId, endPointId: endId }],
    points: [
      { id: startId, label: "Point 1" },
      { id: endId, label: "Point 2" },
    ],
  },
]
export const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: "0195b5ac-b220-7a2c-8c33-67a36a7f7920",
  revision: 7,
  name: "Pattern fixture",
  variables: [countVariable],
  sketches: [pathSketch],
  features: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
})
