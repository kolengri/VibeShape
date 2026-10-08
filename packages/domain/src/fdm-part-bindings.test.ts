import { expect, it } from "bun:test"
import { featureRecordV1Schema } from "./feature-graph"
import { featureIdSchema, partIdSchema } from "./identifiers"
import { derivePartBindings, requiredPartAllocations } from "./part-bindings"
import { boxFeatureType } from "./part-design"
import { fdmFeatureType } from "./part-design-fdm"
import { classifyPartOperation } from "./part-operation"
import { createLengthQuantity } from "./units"

const id = (n: number) =>
  featureIdSchema.parse(`0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`)
const quantity = createLengthQuantity
const origin = { x: quantity(0), y: quantity(0), z: quantity(0) }
function fdm(n: number, parameters: unknown, dependencies: string[] = []) {
  return featureRecordV1Schema.parse({
    schemaVersion: 1,
    semanticInputs: null,
    id: id(n),
    type: fdmFeatureType.type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
  })
}
const sleeve = {
  kind: "flexible-sleeve",
  axis: "Z",
  origin,
  outerDiameter: quantity(14),
  innerDiameter: quantity(10),
  length: quantity(20),
  slotWidth: quantity(1),
  slotLength: quantity(15),
  count: 6,
}
const coupon = {
  kind: "calibration-coupon",
  axis: "Z",
  origin,
  diameterStart: quantity(3),
  diameterStep: quantity(0.1),
  holeCount: 5,
  spacing: quantity(8),
  thickness: quantity(3),
  margin: quantity(4),
}
it.each([coupon, sleeve])(
  "allocates independent FDM geometry as an authored part",
  (parameters) => {
    const feature = fdm(1, parameters)
    const model = { features: [feature], history: [{ kind: "feature" as const, id: feature.id }] }
    const roots = requiredPartAllocations(model)
    expect(roots).toEqual([
      { body: { schemaVersion: 0, featureId: id(1), outputRole: "result" }, origin: "independent" },
    ])
    const bindings = derivePartBindings(
      model,
      roots.map((root) => ({ ...root, id: partIdSchema.parse(id(100)), name: "FDM part" })),
      [],
    )
    expect(bindings).toHaveLength(1)
    expect(bindings?.[0]).toMatchObject({
      id: id(100),
      bodyHistory: [{ featureId: id(1), outputRole: "result" }],
    })
  },
)
it("continues the exact target part through FDM changes and suppression", () => {
  const box = featureRecordV1Schema.parse({
    schemaVersion: 1,
    semanticInputs: null,
    id: id(1),
    type: boxFeatureType.type,
    parameters: { width: quantity(20), height: quantity(20), depth: quantity(20), centered: false },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const targetBody = { schemaVersion: 0, featureId: box.id, outputRole: "result" }
  const feature = fdm(
    2,
    {
      kind: "corner-relief",
      axis: "Z",
      origin,
      targetBody,
      radius: quantity(2),
      depth: quantity(10),
    },
    [box.id],
  )
  const model = {
    features: [box, feature],
    history: [box, feature].map(({ id }) => ({ kind: "feature" as const, id })),
  }
  const roots = requiredPartAllocations(model)
  expect(roots).toHaveLength(1)
  const allocations = roots.map((root) => ({
    ...root,
    id: partIdSchema.parse(id(100)),
    name: "FDM part",
  }))
  const parts = derivePartBindings(model, allocations, [])
  expect(parts?.[0]).toMatchObject({
    id: id(100),
    bodyHistory: [targetBody, { featureId: id(2), outputRole: "result" }],
  })
  const suppressed = derivePartBindings(
    { ...model, features: [box, { ...feature, suppressed: true }] },
    allocations,
    parts ?? [],
  )
  expect(suppressed?.[0]).toMatchObject({ id: id(100), bodyHistory: [targetBody] })
  expect(
    classifyPartOperation(
      fdm(3, { ...sleeve, targetBody: { ...targetBody, outputRole: "split.negative" } }, [box.id]),
    ),
  ).toMatchObject({
    kind: "modify",
    target: { ...targetBody, outputRole: "split.negative" },
    consumed: [],
  })
})
