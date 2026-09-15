import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { expect, it } from "vitest"
import { createQueryDispatcher, documentCoreQueryHandlers } from "./queries"

it("bounds serialized multibyte body labels and allows a smaller page", () => {
  const featureId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ad"
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: boxFeatureType.type,
    parameters: {},
    dependencies: [],
    references: [],
    suppressed: false,
    label: "測".repeat(120),
  })
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
    revision: 2,
    name: "Bounded body evidence",
    features: [feature],
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
  })
  const shape = {
    valid: true,
    volume: 1,
    surfaceArea: 6,
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    solidCount: 1,
    faceCount: 6,
    edgeCount: 12,
  }
  const hash = "a".repeat(64)
  const evidence = {
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: 2,
    generation: 3,
    features: [
      {
        featureId,
        contentHash: hash,
        status: "succeeded",
        shape: { ...shape, volume: 200, solidCount: 200 },
      },
    ],
    bodies: Array.from({ length: 200 }, (_, index) => ({
      featureId,
      outputRole: `${"r".repeat(124)}${String(index).padStart(4, "0")}`,
      contentHash: hash,
      shape,
    })),
  }
  const modules = createModuleRegistry([documentCoreModule])
  if (!modules.ok) throw new Error("Expected core query registration.")
  const dispatcher = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!dispatcher.ok) throw new Error("Expected registered query handlers.")
  const query = {
    kind: "org.vibeshape.model.body-measurements",
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: 2,
  }
  const run = (limit: number) =>
    dispatcher.dispatcher.dispatch(snapshot, { ...query, limit }, { bodyMeasurements: evidence })
  expect(run(200)).toMatchObject({ ok: false, diagnostic: { code: "query-result-too-large" } })
  expect(run(100)).toMatchObject({ ok: true, view: { nextCursor: "100", data: { total: 200 } } })
})
