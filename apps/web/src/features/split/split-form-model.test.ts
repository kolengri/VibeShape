import {
  createLengthQuantity,
  featureIdSchema,
  featureRecordSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { splitFeatureType } from "@vibeshape/domain/part-design-split"
import { describe, expect, it } from "vitest"
import messages from "../../i18n/messages/en.json"
import {
  parseSplitForm,
  type SplitFormMode,
  splitFeatureRecord,
  splitFormValues,
  splitMidpointExpression,
} from "./split-form-model"

const targetId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4301")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4302")
const mode: SplitFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "split.positive" },
  createFeatureId: () => featureId,
  featureLabel: "Split 1",
}
const bounds = { min: [-20, -10, 10], max: [10, 30, 50] } as const
const units = { length: "mm", angle: "deg" } as const
const copy = messages.app.split

describe("Split form contract", () => {
  it("starts inside exact source bounds and explicitly chooses the midpoint of each plane", () => {
    expect(splitFormValues(mode, bounds, units)).toEqual({ plane: "XY", offset: "30 mm" })
    expect(splitMidpointExpression(bounds, "XZ", units)).toBe("10 mm")
    expect(splitMidpointExpression(bounds, "YZ", units)).toBe("-5 mm")
  })
  it("resolves signed offsets, bare display units and variables while retaining exact output identity", () => {
    const imperial = { length: "in", angle: "deg" } as const
    const parsed = parseSplitForm({ plane: "YZ", offset: "-2" }, [], imperial, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    expect(parsed.offset.value).toBeCloseTo(-50.8)
    const variable = {
      schemaVersion: 0 as const,
      id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4303"),
      name: "cut",
      expression: "-2 cm",
    }
    const expression = parseSplitForm({ plane: "XZ", offset: "#cut" }, [variable], units, copy)
    if (!expression.ok) throw new Error(JSON.stringify(expression))
    const feature = splitFeatureRecord(mode, featureId, expression)
    expect(feature.parameters).toMatchObject({
      targetBody: mode.targetBody,
      offset: { value: -20, source: { expression: "#cut" } },
    })
    expect(feature.dependencies).toEqual([targetId])
    expect(feature.references).toEqual([])
  })
  it.each([
    ["90 deg", copy.invalidDimension],
    ["#missing", copy.invalidExpression],
    ["100001 mm", copy.invalidRange],
    ["-100001 mm", copy.invalidRange],
  ])("rejects %s without constructing a feature", (offset, message) => {
    expect(parseSplitForm({ plane: "XY", offset }, [], units, copy)).toEqual({
      ok: false,
      issues: { offset: message },
    })
  })
  it("reopens the raw expression and preserves feature identity and exact target on edit", () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureId,
      type: splitFeatureType.type,
      parameters: {
        targetBody: mode.targetBody,
        plane: "XZ",
        offset: createLengthQuantity(25.4, "mm", "1 in"),
      },
      dependencies: [targetId],
      references: [],
      suppressed: false,
      label: "Cut housing",
    })
    const editing = { kind: "edit" as const, feature }
    expect(splitFormValues(editing, bounds, units)).toEqual({ plane: "XZ", offset: "1 in" })
    const parsed = parseSplitForm({ plane: "YZ", offset: "-10 mm" }, [], units, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const updated = splitFeatureRecord(editing, featureId, parsed)
    expect({ ...updated, parameters: feature.parameters }).toEqual(feature)
    expect(updated.parameters.targetBody).toEqual(mode.targetBody)
  })
})
