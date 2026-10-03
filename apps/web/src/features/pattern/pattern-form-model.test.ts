import { describe, expect, it } from "vitest"
import { editPartDesignTool, modifyingSolidTargetFeatures } from "../part-design/part-design-tool"
import { parsePatternForm, patternFeatureRecord, patternFormValues } from "./pattern-form-model"
import { copy, countVariable, featureId, mode, targetId, units } from "./pattern-test-fixtures"

describe("Body Pattern authoring contract", () => {
  it("keeps a default full revolution exact in radians", () => {
    const radianUnits = { length: "mm", angle: "rad" } as const
    const parsed = parsePatternForm(
      { ...patternFormValues(mode, radianUnits), kind: "circular" },
      [],
      radianUnits,
      copy,
    )
    expect(parsed).toMatchObject({ ok: true, parameters: { angle: { value: 2 * Math.PI } } })
  })
  it("authors scalar variable count, signed spacing and the exact semantic target", () => {
    const parsed = parsePatternForm(
      { ...patternFormValues(mode, units), count: "#instances", spacing: "-2" },
      [countVariable],
      { length: "in", angle: "rad" },
      copy,
    )
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const feature = patternFeatureRecord(mode, featureId, parsed)
    expect(feature.parameters).toMatchObject({
      kind: "linear",
      targetBody: mode.targetBody,
      count: { value: 4, source: { expression: "#instances" } },
      spacing: { value: -50.8, source: { expression: "-2 in" } },
    })
    expect(feature.dependencies).toEqual([targetId])
    expect(feature.references).toEqual([])
    expect(editPartDesignTool(feature)).toEqual({ kind: "edit-pattern", featureId })
    expect(modifyingSolidTargetFeatures([feature])).toEqual([])
  })
  it("preserves raw circular count/angle/center intent, identity and metadata on edit", () => {
    const values = {
      ...patternFormValues(mode, units),
      kind: "circular" as const,
      axis: "Z" as const,
      count: "#instances",
      angle: "-360 deg",
      centerX: "1 cm",
      centerY: "-2 mm",
      centerZ: "0",
    }
    const parsed = parsePatternForm(values, [countVariable], units, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const feature = {
      ...patternFeatureRecord(mode, featureId, parsed),
      suppressed: true,
      label: "Fastener copies",
    }
    const editing = { kind: "edit" as const, feature }
    expect(patternFormValues(editing, { length: "in", angle: "rad" })).toMatchObject({
      count: "#instances",
      angle: "-360 deg",
      centerX: "1 cm",
      centerY: "-2 mm",
      centerZ: "0 mm",
      kind: "circular",
      axis: "Z",
    })
    expect(patternFeatureRecord(editing, featureId, parsed)).toEqual(feature)
  })
  it.each([
    ["1", copy.invalidCountRange],
    ["257", copy.invalidCountRange],
    ["2.5", copy.invalidCountRange],
    ["2 mm", copy.invalidCountDimension],
    ["#missing", copy.invalidExpression],
  ])("rejects count %s with a repairable diagnostic", (count, message) => {
    expect(
      parsePatternForm({ ...patternFormValues(mode, units), count }, [], units, copy),
    ).toMatchObject({ ok: false, issues: { count: message } })
  })
  it.each([
    ["0 mm", copy.invalidRange],
    ["100001 mm", copy.invalidRange],
    ["50001 mm", copy.invalidSpan],
  ])("bounds signed spacing and total span for %s", (spacing, message) => {
    expect(
      parsePatternForm({ ...patternFormValues(mode, units), spacing }, [], units, copy),
    ).toMatchObject({ ok: false, issues: { spacing: message } })
  })
  it.each([
    ["0 deg", copy.invalidAngleRange],
    ["361 deg", copy.invalidAngleRange],
    ["1 mm", copy.invalidAngleDimension],
  ])("bounds circular angle %s", (angle, message) => {
    expect(
      parsePatternForm(
        { ...patternFormValues(mode, units), kind: "circular", angle },
        [],
        units,
        copy,
      ),
    ).toMatchObject({ ok: false, issues: { angle: message } })
  })
  it("rejects explicit centers outside their bounds", () => {
    expect(
      parsePatternForm(
        { ...patternFormValues(mode, units), kind: "circular", centerY: "-100001 mm" },
        [],
        units,
        copy,
      ),
    ).toMatchObject({ ok: false, issues: { centerY: copy.invalidCenterRange } })
  })
})
