import {
  createAngleQuantity,
  createLengthQuantity,
  featureIdSchema,
  featureRecordSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { placementFeatureType } from "@vibeshape/domain/part-design-placement"
import { describe, expect, it } from "vitest"
import messages from "../../i18n/messages/en.json"
import {
  type PlacementFormMode,
  parsePlacementForm,
  placementFeatureRecord,
  placementFormValues,
} from "./placement-form-model"

const targetId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4301")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4302")
const mode: PlacementFormMode = {
  kind: "create",
  targetBody: { schemaVersion: 0, featureId: targetId, outputRole: "body.second" },
  createFeatureId: () => featureId,
  featureLabel: "Placement 1",
}
const units = { length: "mm", angle: "deg" } as const
const copy = {
  ...messages.app.placement,
  invalidRange: messages.app.placement.invalidTranslationRange,
}

describe("placement form contract", () => {
  it("resolves signed translation and rotation expressions while preserving exact body identity", () => {
    const values = {
      ...placementFormValues(mode, units),
      translationX: "#offset",
      rotationZ: "#turn",
    }
    const variables = [
      {
        schemaVersion: 0 as const,
        id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4303"),
        name: "offset",
        expression: "-2 cm",
      },
      {
        schemaVersion: 0 as const,
        id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4304"),
        name: "turn",
        expression: "90 deg",
      },
    ]
    const parsed = parsePlacementForm(values, variables, units, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    expect(parsed.translation.x.value).toBe(-20)
    expect(parsed.translation.x.source.expression).toBe("#offset")
    expect(parsed.rotation.z.value).toBeCloseTo(Math.PI / 2)
    expect(parsed.rotation.z.source.expression).toBe("#turn")
    const feature = placementFeatureRecord(mode, featureId, parsed)
    expect(feature.id).toBe(featureId)
    expect(feature.dependencies).toEqual([targetId])
    expect(feature.parameters.targetBody).toEqual(mode.targetBody)
    expect(feature.type).toEqual(placementFeatureType.type)
  })
  it("uses document display units for bare literals and retains finite domain bounds", () => {
    const imperial = { length: "in", angle: "rad" } as const
    const parsed = parsePlacementForm(
      { ...placementFormValues(mode, imperial), translationY: "-2", rotationX: "1" },
      [],
      imperial,
      copy,
    )
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    expect(parsed.translation.y.value).toBeCloseTo(-50.8)
    expect(parsed.rotation.x.value).toBe(1)
    const invalid = parsePlacementForm(
      { ...placementFormValues(mode, units), translationX: "100001 mm", rotationZ: "361 deg" },
      [],
      units,
      copy,
    )
    expect(invalid).toEqual({
      ok: false,
      issues: { translationX: copy.invalidTranslationRange, rotationZ: copy.invalidRotationRange },
    })
  })
  it("rejects mixed dimensions and unknown variables before constructing a feature", () => {
    const invalid = parsePlacementForm(
      {
        ...placementFormValues(mode, units),
        translationX: "90 deg",
        rotationY: "2 mm",
        rotationZ: "#missing",
      },
      [],
      units,
      copy,
    )
    expect(invalid).toEqual({
      ok: false,
      issues: {
        translationX: copy.invalidDimension,
        rotationY: copy.invalidAngleDimension,
        rotationZ: copy.invalidExpression,
      },
    })
  })
  it("reopens expression sources and changes only parameters of the same authored feature", () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureId,
      type: placementFeatureType.type,
      parameters: {
        targetBody: mode.targetBody,
        translation: {
          x: createLengthQuantity(25.4, "mm", "1 in"),
          y: createLengthQuantity(0),
          z: createLengthQuantity(0),
        },
        rotation: {
          x: createAngleQuantity(0),
          y: createAngleQuantity(0),
          z: createAngleQuantity(90, "deg", "90 deg"),
        },
      },
      dependencies: [targetId],
      references: [],
      suppressed: false,
      label: "Position housing",
    })
    const editing = { kind: "edit" as const, feature }
    const values = placementFormValues(editing, units)
    expect(values.translationX).toBe("1 in")
    expect(values.rotationZ).toBe("90 deg")
    const parsed = parsePlacementForm({ ...values, translationX: "30 mm" }, [], units, copy)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    const updated = placementFeatureRecord(editing, featureId, parsed)
    expect(updated.id).toBe(feature.id)
    expect(updated.label).toBe(feature.label)
    expect(updated.dependencies).toEqual(feature.dependencies)
    expect(updated.parameters.targetBody).toEqual(feature.parameters.targetBody)
    expect(updated.parameters.translation).toMatchObject({ x: { value: 30 } })
  })
})
