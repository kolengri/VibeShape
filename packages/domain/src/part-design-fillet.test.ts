import { expect, it } from "bun:test"
import { featureBodyDependencies } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  filletFeatureParametersV3Schema,
  filletFeatureTypeV3,
  partDesignFeatureTypeHandlers,
  readFilletFeatureParametersV3,
} from "./part-design"
import { classifyPartOperation } from "./part-operation"
import { createLengthQuantity } from "./units"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f3402"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3403"
const role = "split.positive"
const reference = (kind: "edge" | "face", name: string = kind) => ({
  schemaVersion: 1,
  featureId: sourceId,
  outputRole: role,
  kind,
  semanticRole: `source.${name}`,
  signature: {
    kind,
    geometryClass: kind === "edge" ? "LINE" : "PLANE",
    measure: 20,
    centroid: [0, 0, 0],
    bounds: { min: [0, 0, 0], max: [20, 0, 0] },
    boundaryCount: kind === "edge" ? 2 : 4,
    adjacentGeometryClasses: ["PLANE", "PLANE"],
  },
})
const law = (start = 1, end = 3) => ({
  startRadius: createLengthQuantity(start),
  endRadius: createLengthQuantity(end),
  reverse: true,
})
function parameters() {
  return filletFeatureParametersV3Schema.parse({
    targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: role },
    radius: createLengthQuantity(2),
    targets: [
      { kind: "edge", edge: reference("edge"), variableRadius: law() },
      { kind: "face", face: reference("face") },
    ],
  })
}
function fixture() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const registry = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!registry.ok) throw new Error(registry.diagnostic.message)
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: filletFeatureTypeV3.type,
    parameters: parameters(),
    dependencies: [sourceId],
    references: [],
    suppressed: false,
  })
  return { registry: registry.registry, feature }
}

it("registers exact Fillet V3 body-role intent as a modifier of the named output", () => {
  const { registry, feature } = fixture()
  expect(registry.validateFeature(feature)).toMatchObject({ ok: true })
  expect(readFilletFeatureParametersV3(feature)?.targetBody.outputRole).toBe(role)
  expect(featureBodyDependencies(feature)).toEqual<unknown>([
    { featureId: sourceId, outputRole: role },
  ])
  expect(classifyPartOperation({ ...feature, schemaVersion: 1, semanticInputs: [] })).toMatchObject(
    {
      kind: "modify",
      target: { featureId: sourceId, outputRole: role },
    },
  )
  expect(registry.validateFeature({ ...feature, dependencies: [featureId] })).toMatchObject({
    ok: false,
  })
  expect(
    registry.validateFeature({
      ...feature,
      references: [{ ...reference("edge"), schemaVersion: 0 }],
    }),
  ).toMatchObject({ ok: false })
})

it("rejects foreign owners, duplicates, out-of-range radii and degenerate variable laws", () => {
  const valid = parameters()
  const edge = valid.targets[0]
  for (const patch of [
    { targets: [] },
    {
      targets: Array.from({ length: 257 }, (_, index) => ({
        kind: "face",
        face: reference("face", `f${index}`),
      })),
    },
    { targets: [edge, edge] },
    { targets: [{ kind: "face", face: { ...reference("face"), outputRole: "result" } }] },
    { targets: [{ kind: "edge", edge: { ...reference("edge"), featureId } }] },
    { targets: [{ kind: "edge", edge: { ...reference("edge"), nativeIndex: 3 } }] },
    { targets: [{ kind: "edge", edge: reference("face") }] },
    { radius: createLengthQuantity(0) },
    { radius: createLengthQuantity(0.0005) },
    { radius: createLengthQuantity(100_001) },
    { radius: { ...createLengthQuantity(1), value: Number.NaN } },
    { targets: [{ kind: "edge", edge: reference("edge"), variableRadius: law(2, 2) }] },
    { targets: [{ kind: "edge", edge: reference("edge"), variableRadius: law(0, 2) }] },
    { targets: [{ kind: "face", face: reference("face"), variableRadius: law() }] },
    {
      targets: [
        { kind: "edge", edge: reference("edge"), variableRadius: { ...law(), reverse: undefined } },
      ],
    },
  ])
    expect(filletFeatureParametersV3Schema.safeParse({ ...valid, ...patch }).success).toBe(false)
  expect(
    filletFeatureParametersV3Schema.safeParse({
      ...valid,
      targets: Array.from({ length: 256 }, (_, index) => ({
        kind: "face",
        face: reference("face", `f${index}`),
      })),
    }).success,
  ).toBe(true)
})

it("resolves constant and variable radius expressions with dimension, range and law checks", () => {
  const { registry, feature } = fixture()
  const withExpressions = (start: string, end: string) => ({
    ...feature,
    parameters: {
      ...parameters(),
      radius: createLengthQuantity(99, "mm", "1.5 mm"),
      targets: [
        {
          kind: "edge",
          edge: reference("edge"),
          variableRadius: {
            startRadius: createLengthQuantity(99, "mm", start),
            endRadius: createLengthQuantity(98, "mm", end),
            reverse: false,
          },
        },
      ],
    },
  })
  expect(
    registry.resolveFeatureParameters(withExpressions("1 mm", "4 mm"), new Map()),
  ).toMatchObject({
    ok: true,
    feature: {
      parameters: {
        radius: { value: 1.5 },
        targets: [{ variableRadius: { startRadius: { value: 1 }, endRadius: { value: 4 } } }],
      },
    },
  })
  for (const [start, end] of [
    ["1 deg", "4 mm"],
    ["1 mm", "0 mm"],
    ["2 mm", "2 mm"],
  ] as const)
    expect(registry.resolveFeatureParameters(withExpressions(start, end), new Map())).toMatchObject(
      { ok: false },
    )
})

it("projects radii, laws and semantic refs into content identity without the owner ID", () => {
  const { feature } = fixture()
  const handler = partDesignFeatureTypeHandlers.find(
    ({ type }) => type.typeId === feature.type.typeId && type.schemaVersion === 3,
  )
  if (!handler?.contentParameters) throw new Error("Registered Fillet V3 content is required.")
  const content = handler.contentParameters(feature.parameters)
  expect(content).toEqual({
    radius: 2,
    targets: [
      {
        kind: "edge",
        edge: expect.objectContaining({ schemaVersion: 1, outputRole: role, kind: "edge" }),
        variableRadius: { startRadius: 1, endRadius: 3, reverse: true },
      },
      { kind: "face", face: expect.objectContaining({ outputRole: role, kind: "face" }) },
    ],
  })
  expect(JSON.stringify(content)).not.toContain(sourceId)
})
