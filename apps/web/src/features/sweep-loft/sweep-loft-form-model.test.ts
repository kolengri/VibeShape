import { sketchEntityIdSchema, sketchProfileSelectorSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import {
  reorderLoftSection,
  sweepLoftFeatureRecord,
  sweepLoftFormValues,
} from "./sweep-loft-form-model"
import { featureId, id, mode, paths, profiles, snapshot } from "./sweep-loft-test-fixtures"

describe("Sweep and Loft authoring contracts", () => {
  it("keeps explicit Loft order, ruled intent and authored identity through edit", () => {
    const first = profiles[0]?.selector,
      second = profiles[1]?.selector
    if (!first || !second) throw new Error("Two sections required.")
    const values = { ...sweepLoftFormValues(mode("loft")), sections: [second, first], ruled: true }
    const feature = sweepLoftFeatureRecord(
      mode("loft"),
      featureId,
      values,
      profiles,
      paths,
      snapshot,
    )
    if (!feature) throw new Error("Valid Loft fixture required.")
    expect(feature.parameters).toEqual({ sections: [second, first], ruled: true })
    expect(feature.dependencies).toEqual([])
    expect(feature.references).toEqual([])
    const editing = { kind: "edit" as const, operation: "loft" as const, feature }
    expect(sweepLoftFormValues(editing)).toMatchObject(values)
    const updated = sweepLoftFeatureRecord(
      editing,
      featureId,
      { ...values, sections: reorderLoftSection(values.sections, 1, -1) },
      profiles,
      paths,
      snapshot,
    )
    expect(updated).toMatchObject({
      id: feature.id,
      label: feature.label,
      parameters: { sections: [first, second], ruled: true },
    })
  })
  it("blocks duplicate, insufficient, unavailable and holed Loft sections", () => {
    const first = profiles[0]?.selector,
      second = profiles[1]?.selector
    if (!first || !second) throw new Error("Two sections required.")
    const holed = sketchProfileSelectorSchema.parse({ ...first, holeBoundaryEntityIds: [[id(99)]] })
    for (const sections of [[], [first], [first, first], [first, holed]])
      expect(
        sweepLoftFeatureRecord(
          mode("loft"),
          featureId,
          { ...sweepLoftFormValues(mode("loft")), sections },
          profiles,
          paths,
          snapshot,
        ),
      ).toBeNull()
    expect(
      sweepLoftFeatureRecord(
        mode("loft"),
        featureId,
        { ...sweepLoftFormValues(mode("loft")), sections: [first, second] },
        profiles.slice(0, 1),
        paths,
        snapshot,
      ),
    ).toBeNull()
  })
  it("sorts selected path IDs without changing explicit start direction and rejects unknown curves", () => {
    const values = {
      ...sweepLoftFormValues(mode("sweep")),
      profileKey: profiles[0]?.key ?? "",
      pathSketchId: id(4),
      entityIds: [sketchEntityIdSchema.parse(id(42)), sketchEntityIdSchema.parse(id(41))],
      startPointId: id(32),
    }
    const feature = sweepLoftFeatureRecord(
      mode("sweep"),
      featureId,
      values,
      profiles,
      paths,
      snapshot,
    )
    expect(feature?.parameters.path).toEqual({
      schemaVersion: 0,
      sketchId: id(4),
      entityIds: [id(41), id(42)],
      startPointId: id(32),
    })
    expect(
      sweepLoftFeatureRecord(
        mode("sweep"),
        featureId,
        { ...values, startPointId: id(30) },
        profiles,
        paths,
        snapshot,
      )?.parameters.path,
    ).toMatchObject({ startPointId: id(30) })
    expect(
      sweepLoftFeatureRecord(
        mode("sweep"),
        featureId,
        { ...values, entityIds: [sketchEntityIdSchema.parse(id(99))] },
        profiles,
        paths,
        snapshot,
      ),
    ).toBeNull()
    expect(
      sweepLoftFeatureRecord(
        mode("sweep"),
        featureId,
        { ...values, startPointId: id(99) },
        profiles,
        paths,
        snapshot,
      ),
    ).toBeNull()
  })
})
