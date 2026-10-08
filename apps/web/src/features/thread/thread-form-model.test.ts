import { describe, expect, it } from "bun:test"
import { editPartDesignTool, modifyingSolidTargetFeatures } from "../part-design/part-design-tool"
import {
  parseThreadForm,
  type ThreadFormValues,
  threadFeatureRecord,
  threadFormValues,
} from "./thread-form-model"
import { copy, featureId, mode, pitchVariable, targetId, units } from "./thread-test-fixtures"

describe("Modeled Thread authoring contract", () => {
  it("authors conservative three-turn defaults and the exact semantic target", () => {
    const parsed = parseThreadForm(threadFormValues(mode, units), mode, [], units, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const feature = threadFeatureRecord(mode, featureId, parsed)
    expect(feature.parameters).toMatchObject({
      targetBody: mode.targetBody,
      kind: "external",
      axis: "Z",
      handedness: "right",
      nominalDiameter: { value: 10 },
      pitch: { value: 2 },
      length: { value: 6 },
      depth: { value: 0.8 },
      clearance: { value: 0.1 },
      starts: { value: 1 },
      phase: { value: 0 },
      runIn: { value: 0 },
      runOut: { value: 0 },
    })
    expect(feature.dependencies).toEqual([targetId])
    expect(feature.references).toEqual([])
    expect(editPartDesignTool(feature)).toEqual({ kind: "edit-thread", featureId })
    expect(modifyingSolidTargetFeatures([feature])).toEqual([feature])
  })
  it("keeps variable intent, explicit origin, phase, handedness and source identity on edit", () => {
    const values = {
      ...threadFormValues(mode, units),
      kind: "internal" as const,
      axis: "X" as const,
      handedness: "left" as const,
      pitch: "#step",
      originX: "-1 in",
      phase: "-360 deg",
      starts: "2",
      runIn: "0.5 mm",
      runOut: "1 mm",
    }
    const parsed = parseThreadForm(values, mode, [pitchVariable], units, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const feature = {
      ...threadFeatureRecord(mode, featureId, parsed),
      label: "Custom tapped bore",
      suppressed: true,
    }
    const editing = { kind: "edit" as const, feature }
    expect(threadFormValues(editing, { length: "in", angle: "rad" })).toMatchObject(values)
    expect("origin" in parsed.parameters && parsed.parameters.origin.x.value).toBe(-25.4)
    expect(parsed.parameters.phase.value).toBe(-2 * Math.PI)
    expect(threadFeatureRecord(editing, featureId, parsed)).toEqual(feature)
  })
  it.each([
    ["starts", "1.5", "invalidStartsRange"],
    ["starts", "5", "invalidStartsRange"],
    ["starts", "2 mm", "invalidScalarDimension"],
    ["pitch", "0.1 mm", "invalidPitchRange"],
    ["pitch", "21 mm", "invalidPitchRange"],
    ["nominalDiameter", "0 mm", "invalidDimensionRange"],
    ["clearance", "-0.1 mm", "invalidAllowanceRange"],
    ["originY", "100001 mm", "invalidOriginRange"],
    ["phase", "361 deg", "invalidPhaseRange"],
    ["phase", "1 mm", "invalidAngleDimension"],
    ["depth", "#missing", "invalidExpression"],
  ] as const)("rejects %s=%s with the specific field diagnostic", (field, expression, message) => {
    expect(
      parseThreadForm(
        { ...threadFormValues(mode, units), [field]: expression },
        mode,
        [],
        units,
        copy,
      ),
    ).toMatchObject({ ok: false, issues: { [field]: copy[message] } })
  })
  it.each([
    [{ runIn: "6 mm" }, "length", "invalidBand"],
    [{ length: "100 mm", pitch: "0.2 mm", depth: "0.1 mm" }, "pitch", "invalidTurns"],
    [{ depth: "2 mm" }, "depth", "invalidDepth"],
    [{ nominalDiameter: "1.5 mm" }, "depth", "invalidRootRadius"],
  ] as const)("blocks coupled geometry limits %j", (change, field, message) => {
    expect(
      parseThreadForm({ ...threadFormValues(mode, units), ...change }, mode, [], units, copy),
    ).toMatchObject({ ok: false, issues: { [field]: copy[message] } })
  })
  it("interprets bare lengths/angles in document units while starts stays scalar", () => {
    const display = { length: "in", angle: "rad" } as const
    const values: ThreadFormValues = {
      ...threadFormValues(mode, display),
      nominalDiameter: "0.5",
      phase: "1",
      starts: "2",
    }
    const parsed = parseThreadForm(values, mode, [], display, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    expect(parsed.parameters.nominalDiameter.value).toBe(12.7)
    expect(parsed.parameters.phase.value).toBe(1)
    expect(parsed.parameters.starts.source.expression).toBe("2")
  })
  it("accepts twenty authored turns and rejects the next turn without silently changing pitch or band", () => {
    const values = { ...threadFormValues(mode, units), length: "40 mm" }
    const parsed = parseThreadForm(values, mode, [], units, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    expect(parsed.parameters.length.source.expression).toBe("40 mm")
    expect(parsed.parameters.pitch.value).toBe(2)
    expect(parseThreadForm({ ...values, length: "42 mm" }, mode, [], units, copy)).toMatchObject({
      ok: false,
      issues: { pitch: copy.invalidTurns },
    })
  })
})
