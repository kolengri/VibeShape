import { createModelBodyMeasurementEvidence } from "@vibeshape/application/model-measurements"
import type { DocumentRebuildOutcome } from "@vibeshape/application/persistent-document-session"
import {
  boxFeatureType,
  createLengthQuantity,
  documentSnapshotSchema,
  type FeatureRecord,
  featureRecordSchema,
  holeFeatureTypeV2,
} from "@vibeshape/domain"
import { modelBodyMeasurementEvidenceSchema } from "@vibeshape/domain/model-body-measurements"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { holeTargetBodyOptions } from "./hole-target-body"

vi.mock("@vibeshape/application/model-measurements", () => ({
  createModelBodyMeasurementEvidence: vi.fn(),
}))

const id = (suffix: number) => `0195b5ac-b220-7a2c-8c33-${String(suffix).padStart(12, "0")}`
const shape = {
  valid: true,
  volume: 100,
  surfaceArea: 60,
  bounds: { min: [0, 0, 0], max: [10, 10, 10] },
  solidCount: 1,
  faceCount: 6,
  edgeCount: 12,
}
const contentHash = "a".repeat(64)
const source = featureRecordSchema.parse({
  schemaVersion: 0,
  id: id(1),
  type: boxFeatureType.type,
  parameters: {},
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Source",
})

function consumer(target = source, outputRole = "pattern.instance.0") {
  return featureRecordSchema.parse({
    ...source,
    id: id(target.id === source.id ? 2 : 3),
    type: holeFeatureTypeV2.type,
    label: "Hole",
    dependencies: [target.id],
    parameters: {
      sketchId: id(10),
      pointIds: [id(11)],
      diameter: createLengthQuantity(2),
      direction: "forward",
      extent: "through-all",
      targetBody: { schemaVersion: 0, featureId: target.id, outputRole },
    },
  })
}

function fixture(features: FeatureRecord[] = [source], roles: (string | undefined)[] = ["result"]) {
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(100),
    revision: 1,
    name: "Hole targets",
    createdAt: "2026-09-13T00:00:00Z",
    updatedAt: "2026-09-13T00:00:00Z",
    features,
  })
  const evidence = modelBodyMeasurementEvidenceSchema.parse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: 1,
    features: features.map((feature) => ({
      featureId: feature.id,
      status: "succeeded",
      contentHash,
      shape: { ...shape, solidCount: feature.id === source.id ? roles.length : 1 },
    })),
    bodies: features.flatMap((feature) =>
      (feature.id === source.id ? roles : ["result"]).map((outputRole) => ({
        featureId: feature.id,
        outputRole,
        contentHash,
        shape,
      })),
    ),
  })
  vi.mocked(createModelBodyMeasurementEvidence).mockReturnValue({ ok: true, evidence })
  return {
    snapshot,
    rebuild: { ok: true } as DocumentRebuildOutcome,
    unnamedFeature: "Unnamed",
    formatRole: (feature: string, role: string) => `${feature} / ${role}`,
    missingRole: (feature: string, role: string) => `${feature} / ${role} unavailable`,
  }
}

beforeEach(() => vi.resetAllMocks())

describe("Hole target body selection", () => {
  it("offers unconsumed sibling bodies and excludes the consumed source role", () => {
    const hole = consumer()
    const args = fixture([source, hole], ["pattern.instance.0", "pattern.instance.1"])
    expect(holeTargetBodyOptions(args)).toEqual([
      {
        featureId: source.id,
        outputRole: "pattern.instance.1",
        label: "Source / pattern.instance.1",
      },
      { featureId: hole.id, outputRole: "result", label: "Hole" },
    ])
    expect(createModelBodyMeasurementEvidence).toHaveBeenCalledWith(args.snapshot, args.rebuild)
  })

  it("releases edited and descendant consumption without permitting a dependency cycle", () => {
    const hole = consumer()
    const descendant = consumer(hole, "result")
    const args = fixture([source, hole, descendant], ["pattern.instance.0", "pattern.instance.1"])
    expect(holeTargetBodyOptions({ ...args, editingFeatureId: hole.id })).toEqual([
      {
        featureId: source.id,
        outputRole: "pattern.instance.0",
        label: "Source / pattern.instance.0",
      },
      {
        featureId: source.id,
        outputRole: "pattern.instance.1",
        label: "Source / pattern.instance.1",
      },
    ])
  })

  it("preserves a single-solid whole-result target when editing legacy intent", () => {
    const args = fixture()
    expect(holeTargetBodyOptions({ ...args, currentTarget: { featureId: source.id } })[0]).toEqual({
      featureId: source.id,
      label: "Source",
    })
  })

  it("does not offer an aggregate alias for a multi-solid legacy target", () => {
    const args = fixture([source], ["pattern.instance.0", "pattern.instance.1"])
    const options = holeTargetBodyOptions({ ...args, currentTarget: { featureId: source.id } })
    expect(options.at(-1)).toEqual({ featureId: source.id, label: "Source", missing: true })
    expect(options.slice(0, -1).every((option) => option.outputRole !== undefined)).toBe(true)
  })

  it("keeps a missing named role distinct from an available legacy whole result", () => {
    const args = fixture([source], [undefined])
    expect(
      holeTargetBodyOptions({
        ...args,
        currentTarget: { featureId: source.id, outputRole: "result" },
      }),
    ).toEqual([
      { featureId: source.id, label: "Source" },
      {
        featureId: source.id,
        outputRole: "result",
        label: "Source / result unavailable",
        missing: true,
      },
    ])
  })

  it("offers no geometry targets when current validated evidence is unavailable", () => {
    const args = fixture()
    vi.mocked(createModelBodyMeasurementEvidence).mockReturnValue({
      ok: false,
      code: "invalid-geometry-evidence",
    })
    expect(holeTargetBodyOptions(args)).toEqual([])
    expect(
      holeTargetBodyOptions({
        ...args,
        currentTarget: { featureId: source.id, outputRole: "result" },
      }),
    ).toEqual([
      {
        featureId: source.id,
        outputRole: "result",
        label: "Source / result unavailable",
        missing: true,
      },
    ])
  })
})
