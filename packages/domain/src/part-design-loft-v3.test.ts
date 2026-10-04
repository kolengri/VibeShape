import { expect, it } from "vitest"
import { featureBodyDependencies, featureBodyDependencyIds } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { terminalBodyOutputs } from "./model-bodies"
import {
  loftFeatureParametersV3Schema,
  loftFeatureTypeV3,
  loftV3SupportBodies,
} from "./part-design-loft-v3"

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`
const sections = [0, 1].map((column) => ({
  schemaVersion: 0,
  sketchId: id(100 + column),
  outerBoundaryEntityIds: [0, 1, 2, 3].map((i) => id(column * 10 + i + 1)),
  holeBoundaryEntityIds: [],
}))
const support = {
  schemaVersion: 1,
  featureId: id(500),
  outputRole: "result",
  kind: "face",
  signature: {
    kind: "face",
    geometryClass: "plane",
    measure: 40,
    centroid: [0, -2, 5],
    bounds: { min: [-2, -2, 0], max: [2, -2, 10] },
    boundaryCount: 4,
    adjacentGeometryClasses: ["plane"],
  },
}
const parameters = {
  sections,
  ruled: false,
  outerCorrespondence: [0, 1, 2, 3].map((i) => ({
    sectionEntityIds: [id(i + 1), id(i + 11)],
    sectionStartPointIds: [id(i + 21), id(i + 31)],
  })),
  rails: [],
  guides: [
    {
      name: "Wall",
      segmentTrack: 0,
      continuity: "C0",
      path: { schemaVersion: 0, sketchId: id(300), entityIds: [id(301)], startPointId: id(302) },
    },
  ],
  start: [{ segmentTrack: 0, continuity: "G1", support }],
  end: [{ segmentTrack: 0, continuity: "G2", support }],
}
it("schedules guide sketches and exact support body owners without consuming the support solid", () => {
  const parsed = loftFeatureParametersV3Schema.parse(parameters)
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(900),
    type: loftFeatureTypeV3.type,
    parameters: parsed,
    dependencies: [id(500)],
    references: [],
    suppressed: false,
  })
  expect(loftV3SupportBodies(parsed)).toEqual([{ featureId: id(500), outputRole: "result" }])
  expect(featureBodyDependencies(feature)).toEqual([{ featureId: id(500), outputRole: "result" }])
  expect(featureBodyDependencyIds(feature)).toEqual([])
  const supportBody = { featureId: id(500), outputRole: "result" },
    siblingBody = { featureId: id(500), outputRole: "other" },
    loftBody = { featureId: feature.id, outputRole: "result" },
    bodies = new Map([
      [id(500), [supportBody, siblingBody]],
      [feature.id, [loftBody]],
    ])
  expect(terminalBodyOutputs([feature], bodies)).toEqual([supportBody, siblingBody, loftBody])
  bodies.set(id(500), [siblingBody])
  expect(terminalBodyOutputs([feature], bodies)).toBeNull()
  expect(projectFirstPartyFeatureSemanticInputs(feature)).toEqual({
    recognized: true,
    ok: true,
    inputs: [
      { kind: "sketch", id: id(100) },
      { kind: "sketch", id: id(101) },
      { kind: "sketch", id: id(300) },
      { kind: "feature", id: id(500) },
    ],
  })
})
it.each([
  { ...parameters, ruled: true },
  { ...parameters, outerCorrespondence: parameters.outerCorrespondence.slice(1) },
  {
    ...parameters,
    outerCorrespondence: [...parameters.outerCorrespondence, parameters.outerCorrespondence[0]],
  },
  { ...parameters, guides: [...parameters.guides, ...parameters.guides] },
  { ...parameters, start: [...parameters.start, ...parameters.start] },
  { ...parameters, end: [{ ...parameters.end[0], support: { ...support, outputRole: "other" } }] },
  { ...parameters, rails: [{ vertexTrack: 4, path: parameters.guides[0]?.path }] },
])("rejects incompatible or ignored constraint metadata %j", (value) =>
  expect(loftFeatureParametersV3Schema.safeParse(value).success).toBe(false),
)
