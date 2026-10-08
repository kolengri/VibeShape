import { describe, expect, it } from "bun:test"
import { createLengthQuantity, featureIdSchema, variableIdSchema } from "@vibeshape/domain"
import messages from "../../i18n/messages/en.json"
import { exactBodyOptionId } from "../part-design/exact-body-options"
import { editPartDesignTool } from "../part-design/part-design-tool"
import { type FdmFormMode, fdmFormFeature, fdmFormValues, parseFdmForm } from "./fdm-form-model"

const id = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f8002")
const target = {
  schemaVersion: 0 as const,
  featureId: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f8001"),
  outputRole: "pattern.instance.2",
}
const options = [{ id: exactBodyOptionId(target), body: target, label: "Target" }]
const mode: FdmFormMode = { kind: "create", createFeatureId: () => id, featureLabel: "FDM 1" }
const units = { length: "mm", angle: "deg" } as const
const copy = messages.app.fdm

describe("FDM task authoring", () => {
  it("preserves exact body roles, expressions, signed origins and identity through editing", () => {
    const values = fdmFormValues("teardrop-hole", mode)
    values.targetId = options[0]?.id ?? ""
    values.fields.diameter = "#bore"
    values.fields.originX = "-1 in"
    const variables = [
      {
        schemaVersion: 0 as const,
        id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f8003"),
        name: "bore",
        expression: "6 mm",
      },
    ]
    const parsed = parseFdmForm("teardrop-hole", values, options, [], variables, units, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const feature = fdmFormFeature(mode, id, parsed)
    expect(feature.parameters).toMatchObject({
      targetBody: target,
      diameter: { value: 6, source: { expression: "#bore" } },
      origin: { x: { value: -25.4 } },
      roofAngle: { value: Math.PI / 4 },
    })
    expect(feature.dependencies).toEqual([target.featureId])
    expect(editPartDesignTool(feature)).toEqual({ kind: "edit-fdm", featureId: id })
    const editing = {
      kind: "edit" as const,
      feature: { ...feature, label: "Custom bore", suppressed: true },
    }
    const restored = fdmFormValues("teardrop-hole", editing)
    const reparsed = parseFdmForm("teardrop-hole", restored, options, [], variables, units, copy)
    if (!reparsed.ok) throw new Error(JSON.stringify(reparsed))
    expect(fdmFormFeature(editing, id, reparsed)).toEqual(editing.feature)
  })
  it("creates independent calibration coupons with numeric counts and rejects overlap", () => {
    const values = fdmFormValues("calibration-coupon", mode)
    const parsed = parseFdmForm("calibration-coupon", values, [], [], [], units, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    expect(fdmFormFeature(mode, id, parsed).dependencies).toEqual([])
    expect(parsed.parameters).toMatchObject({
      holeCount: 5,
      diameterStart: createLengthQuantity(3, "mm", "3 mm"),
    })
    values.fields.spacing = "3 mm"
    const invalid = parseFdmForm("calibration-coupon", values, [], [], [], units, copy)
    expect(invalid).toMatchObject({ ok: false, issues: { spacing: copy.invalidRange } })
  })
  it.each(["1.5", "0", "33", "2 mm"])("rejects invalid count %s", (count) => {
    const values = fdmFormValues("calibration-coupon", mode)
    values.fields.holeCount = count
    expect(parseFdmForm("calibration-coupon", values, [], [], [], units, copy).ok).toBe(false)
  })
  it("keeps absent targets and saved sketch lines explicit instead of remapping them", () => {
    const values = fdmFormValues("web", mode)
    values.targetId = options[0]?.id ?? ""
    values.sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f8004"
    values.lineIds = ["0195b5ac-b220-7a2c-8c33-67a36a7f8005"]
    expect(parseFdmForm("web", values, [], [], [], units, copy)).toMatchObject({
      ok: false,
      issues: { targetId: copy.unavailable, sketchId: copy.unavailable },
    })
  })
  it("omits disabled boss and bridge settings rather than persisting stale hidden values", () => {
    const values = fdmFormValues("insert-pocket", mode)
    values.targetId = options[0]?.id ?? ""
    const pocket = parseFdmForm("insert-pocket", values, options, [], [], units, copy)
    if (!pocket.ok) throw new Error(JSON.stringify(pocket))
    expect(pocket.parameters).not.toHaveProperty("bossDiameter")
    values.fields.bossDiameter = "10 mm"
    expect(parseFdmForm("insert-pocket", values, options, [], [], units, copy).ok).toBe(false)
    const membrane = fdmFormValues("membrane", mode)
    membrane.targetId = options[0]?.id ?? ""
    membrane.fields.bridgeCount = "invalid"
    expect(parseFdmForm("membrane", membrane, options, [], [], units, copy).ok).toBe(true)
  })
})
