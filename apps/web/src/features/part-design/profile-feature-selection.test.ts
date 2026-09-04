import {
  createLengthQuantity,
  documentSnapshotSchema,
  extrusionFeatureType,
  featureIdSchema,
  featureRecordSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchProfileSelectorSchema,
  sketchRecordSchema,
  topoRefSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import type { ActivePartDesignTool } from "./part-design-tool"
import {
  ineligibleProfileSketchIds,
  initialProfileFeatureSelection,
  nextProfileFeatureSelection,
  profileForFeatureTool,
  profileFeatureToolKey,
  profilesForFeatureTool,
  profileSelectorsEqual,
  revolveAxesEqual,
  revolveAxisAfterProfileSelection,
  topologyReferencesEqual,
} from "./profile-feature-selection"

const firstSketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6101")
const laterSketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6102")
const profile = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: firstSketchId,
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f6111"],
  holeBoundaryEntityIds: [],
})
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6201")
const supportReference = topoRefSchema.parse({
  schemaVersion: 0,
  featureId,
  kind: "face",
  semanticRole: "primitive.cap.end",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 100,
    centroid: [0, 0, 10],
    bounds: { min: [-5, -5, 10], max: [5, 5, 10] },
    direction: [0, 0, 1],
    directionMode: "oriented",
    boundaryCount: 4,
    adjacentGeometryClasses: ["line", "line", "line", "line"],
  },
})
const sketch = (id: typeof firstSketchId, label: string) =>
  sketchRecordSchema.parse({
    schemaVersion: 0,
    id,
    label,
    plane: "xy",
    entities: [],
    constraints: [],
  })
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: extrusionFeatureType.type,
  parameters: {
    profile,
    distance: createLengthQuantity(10, "mm"),
    symmetric: false,
    operation: "new",
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Extrusion 1",
})
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: "0195b5ac-b220-7a2c-8c33-67a36a7f6001",
  revision: 1,
  name: "Profile selection",
  variables: [],
  sketches: [sketch(firstSketchId, "Sketch 1"), sketch(laterSketchId, "Sketch 2")],
  features: [feature],
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
})

describe("profile feature selection", () => {
  it("resolves the committed profile for feature editing", () => {
    const tool = { kind: "edit-extrusion", featureId } satisfies ActivePartDesignTool
    expect(profileForFeatureTool(tool, snapshot)).toEqual(profile)
  })

  it("keeps every active-sketch profile as the initial create-feature selection", () => {
    const second = sketchProfileSelectorSchema.parse({
      ...profile,
      outerBoundaryEntityIds: [sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6112")],
    })
    const otherSketch = sketchProfileSelectorSchema.parse({ ...second, sketchId: laterSketchId })
    const initial = initialProfileFeatureSelection([second, otherSketch, profile], firstSketchId)
    const extrusionTool = {
      kind: "create-extrusion",
      profiles: initial,
    } satisfies ActivePartDesignTool
    const revolveTool = { kind: "create-revolve", profiles: initial } satisfies ActivePartDesignTool

    expect(initial).toEqual([profile, second])
    expect(profilesForFeatureTool(extrusionTool, snapshot)).toEqual([profile, second])
    expect(profilesForFeatureTool(revolveTool, snapshot)).toEqual([profile, second])
    expect(initialProfileFeatureSelection([profile], null)).toEqual([])
  })

  it("keys create tools by the complete canonical profile set", () => {
    const second = sketchProfileSelectorSchema.parse({
      ...profile,
      outerBoundaryEntityIds: [sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6112")],
    })
    const firstKey = profileFeatureToolKey({
      kind: "create-extrusion",
      profiles: [profile, second],
    })
    const equivalentKey = profileFeatureToolKey({
      kind: "create-extrusion",
      profiles: [{ ...second }, { ...profile }],
    })
    const distinctKey = profileFeatureToolKey({ kind: "create-extrusion", profiles: [profile] })

    expect(equivalentKey).toBe(firstKey)
    expect(distinctKey).not.toBe(firstKey)
  })

  it("compares the complete stable selector identity", () => {
    expect(profileSelectorsEqual(profile, { ...profile })).toBe(true)
    expect(
      profileSelectorsEqual(profile, {
        ...profile,
        outerBoundaryEntityIds: [
          sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6112"),
        ],
      }),
    ).toBe(false)
  })

  it("replaces, toggles, and canonically orders task-local profile selections", () => {
    const second = sketchProfileSelectorSchema.parse({
      ...profile,
      outerBoundaryEntityIds: [sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6112")],
    })
    expect(nextProfileFeatureSelection([profile], second, "replace")).toEqual([second])
    expect(nextProfileFeatureSelection([second], profile, "toggle")).toEqual([profile, second])
    expect(nextProfileFeatureSelection([profile, second], profile, "toggle")).toEqual([second])
    expect(nextProfileFeatureSelection([profile], profile, "toggle")).toEqual([])
    expect(
      nextProfileFeatureSelection([profile], { ...second, sketchId: laterSketchId }, "toggle"),
    ).toEqual([{ ...second, sketchId: laterSketchId }])
  })

  it("compares topology references by semantic content instead of object identity", () => {
    expect(topologyReferencesEqual(supportReference, { ...supportReference })).toBe(true)
    expect(topologyReferencesEqual(supportReference, null)).toBe(false)
  })

  it("compares revolve axes by semantic content instead of object identity", () => {
    expect(
      revolveAxesEqual({ kind: "origin-axis", axis: "x" }, { kind: "origin-axis", axis: "x" }),
    ).toBe(true)
    expect(
      revolveAxesEqual({ kind: "origin-axis", axis: "x" }, { kind: "origin-axis", axis: "y" }),
    ).toBe(false)
  })

  it("hides sketches after an edited profile feature", () => {
    const tool = { kind: "edit-extrusion", featureId } satisfies ActivePartDesignTool
    expect(ineligibleProfileSketchIds(snapshot, tool)).toEqual([laterSketchId])
  })

  it("fails closed when the document graph cannot establish profile eligibility", () => {
    const tool = { kind: "edit-extrusion", featureId } satisfies ActivePartDesignTool
    const cyclicSnapshot = documentSnapshotSchema.parse({
      ...snapshot,
      sketches: snapshot.sketches.map((item, index) =>
        index === 0
          ? { ...item, support: { kind: "feature-face", reference: supportReference } }
          : item,
      ),
    })
    expect(ineligibleProfileSketchIds(cyclicSnapshot, tool)).toEqual([firstSketchId, laterSketchId])
  })

  it("keeps a revolve axis on the same sketch and resets a cross-sketch line axis", () => {
    const axis = {
      kind: "sketch-line" as const,
      sketchId: firstSketchId,
      entityId: sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f6111"),
    }
    expect(revolveAxisAfterProfileSelection(axis, profile, { ...profile })).toEqual(axis)
    expect(
      revolveAxisAfterProfileSelection(axis, profile, {
        ...profile,
        sketchId: laterSketchId,
      }),
    ).toEqual({ kind: "origin-axis", axis: "x" })
  })
})
