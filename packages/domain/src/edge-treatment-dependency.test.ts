import { expect, it } from "vitest"
import { createDocumentDependencyGraphFromSnapshot } from "./document-graph"
import { featureRecordSchema } from "./feature-graph"
import { featureIdSchema } from "./identifiers"
import { boxFeatureType, chamferFeatureType, filletFeatureType } from "./part-design"
import { createLengthQuantity } from "./units"

const id = (value: number) =>
  featureIdSchema.parse(`0195b5ac-b280-7a2c-8c33-${value.toString().padStart(12, "0")}`)

function box() {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(1),
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(15),
      height: createLengthQuantity(10),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
    label: "Box 1",
  })
}

it.each([
  ["fillet", filletFeatureType, { radius: createLengthQuantity(2) }],
  ["chamfer", chamferFeatureType, { distance: createLengthQuantity(2) }],
] as const)("recognizes %s dependency models for deletion", (_name, type, parameters) => {
  const target = box()
  const treatment = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(2),
    type: type.type,
    parameters,
    dependencies: [target.id],
    references: [],
    suppressed: false,
    label: "Edge treatment 1",
  })
  const result = createDocumentDependencyGraphFromSnapshot({
    sketches: [],
    features: [target, treatment],
  })
  expect(result).toMatchObject({ ok: true, graph: { dependencyModelIssues: [] } })
})
