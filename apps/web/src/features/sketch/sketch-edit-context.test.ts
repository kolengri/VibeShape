import {
  boxFeatureType,
  createLengthQuantity,
  type DocumentSnapshot,
  type FeatureId,
  type FeatureRecord,
  featureRecordSchema,
  type SketchId,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { mergeSketchEditVisibility, sketchEditContextVisibility } from "./sketch-edit-context"

const ids = {
  activeSketch: "0195b5ac-b220-7a2c-8c33-000000005001" as SketchId,
  supportFeature: "0195b5ac-b220-7a2c-8c33-000000005011" as FeatureId,
  dependentExtrusion: "0195b5ac-b220-7a2c-8c33-000000005002" as FeatureId,
  dependentBoolean: "0195b5ac-b220-7a2c-8c33-000000005003" as FeatureId,
  dependentSketch: "0195b5ac-b220-7a2c-8c33-000000005004" as SketchId,
  nestedExtrusion: "0195b5ac-b220-7a2c-8c33-000000005005" as FeatureId,
  independentFeature: "0195b5ac-b220-7a2c-8c33-000000005006" as FeatureId,
  independentSketch: "0195b5ac-b220-7a2c-8c33-000000005007" as SketchId,
  hiddenFeature: "0195b5ac-b220-7a2c-8c33-000000005008" as FeatureId,
  hiddenSketch: "0195b5ac-b220-7a2c-8c33-000000005009" as SketchId,
} as const

function feature(
  id: FeatureId,
  dependencies: readonly FeatureId[] = [],
  profileSketchId?: SketchId,
) {
  return {
    id,
    dependencies,
    references: [],
    parameters: profileSketchId
      ? {
          profile: {
            schemaVersion: 0,
            sketchId: profileSketchId,
            outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-000000005010"],
            holeBoundaryEntityIds: [],
          },
          distance: createLengthQuantity(10),
          symmetric: false,
          operation: "new",
        }
      : {},
    suppressed: false,
    type: profileSketchId
      ? {
          moduleId: "org.vibeshape.core.part-design",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.part-design.extrusion",
          schemaVersion: 1,
        }
      : {
          moduleId: "org.vibeshape.test",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.feature.test",
          schemaVersion: 1,
        },
  } as unknown as FeatureRecord
}

function sketch(id: SketchId, supportFeatureId?: FeatureId) {
  return {
    schemaVersion: 0,
    id,
    label: id,
    plane: "xy",
    entities: [],
    constraints: [],
    ...(supportFeatureId
      ? {
          support: {
            kind: "feature-face",
            reference: { featureId: supportFeatureId },
          },
        }
      : {}),
  } as unknown as DocumentSnapshot["sketches"][number]
}

function box(id: FeatureId, label: string) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(20),
      height: createLengthQuantity(20),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
    label,
  })
}

describe("sketch edit context visibility", () => {
  it("hides the complete dependent branch when legacy History cannot be derived", () => {
    const snapshot = {
      sketches: [
        sketch(ids.activeSketch, ids.supportFeature),
        sketch(ids.dependentSketch, ids.dependentBoolean),
        sketch(ids.independentSketch),
      ],
      features: [
        feature(ids.supportFeature),
        feature(ids.dependentExtrusion, [], ids.activeSketch),
        feature(ids.dependentBoolean, [ids.dependentExtrusion]),
        feature(ids.nestedExtrusion, [], ids.dependentSketch),
        feature(ids.independentFeature),
      ],
    }

    expect(sketchEditContextVisibility(snapshot, ids.activeSketch)).toEqual({
      featureIds: [ids.dependentExtrusion, ids.dependentBoolean, ids.nestedExtrusion],
      sketchIds: [ids.activeSketch, ids.dependentSketch],
    })
  })

  it("rolls back an independent sketch that appears later in derived History", () => {
    const active = sketch(ids.activeSketch)
    const later = sketch(ids.independentSketch)

    expect(
      sketchEditContextVisibility({ features: [], sketches: [active, later] }, ids.activeSketch),
    ).toEqual({
      featureIds: [],
      sketchIds: [ids.activeSketch, ids.independentSketch],
    })
  })

  it("rolls back an independent feature that appears later in derived History", () => {
    const upstream = box(ids.supportFeature, "Upstream box")
    const later = box(ids.independentFeature, "Later box")

    expect(
      sketchEditContextVisibility(
        { features: [upstream, later], sketches: [sketch(ids.activeSketch)] },
        ids.activeSketch,
      ),
    ).toEqual({
      featureIds: [ids.independentFeature],
      sketchIds: [ids.activeSketch],
    })
  })

  it("preserves explicit hidden state while adding transient edit visibility", () => {
    expect(
      mergeSketchEditVisibility(
        { featureIds: [ids.hiddenFeature], sketchIds: [ids.hiddenSketch] },
        { featureIds: [ids.dependentExtrusion], sketchIds: [ids.activeSketch] },
      ),
    ).toEqual({
      featureIds: [ids.hiddenFeature, ids.dependentExtrusion],
      sketchIds: [ids.hiddenSketch, ids.activeSketch],
    })
  })
})
