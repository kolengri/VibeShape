import { expect, it } from "bun:test"
import { loftFeatureContentParametersV3Schema } from "./loft-patch-network"

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`
const section = (column: number) => ({
  sketchId: id(100 + column),
  frame: { origin: [0, 0, column * 10], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  outer: {
    sourceEntityIds: [1, 2, 3, 4].map((n) => id(column * 10 + n)),
    segments: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ].map((p, i, points) => ({
      entityId: id(column * 10 + i + 1),
      type: "line",
      startPointId: id(column * 10 + i + 30),
      endPointId: id(column * 10 + ((i + 1) % 4) + 30),
      start: p,
      end: points[(i + 1) % 4],
    })),
  },
  holes: [],
})
const parameters = {
  sections: [section(0), section(1)],
  ruled: false,
  outerCorrespondence: [0, 1, 2, 3].map((i) => ({
    sectionEntityIds: [id(i + 1), id(i + 11)],
    sectionStartPointIds: [id(i + 30), id(i + 40)],
  })),
  rails: [],
  guides: [],
  start: [],
  end: [],
}
it("validates canonical directed outer correspondence without positional fallback", () => {
  expect(loftFeatureContentParametersV3Schema.parse(parameters).outerCorrespondence).toEqual(
    parameters.outerCorrespondence,
  )
})
it.each([
  { ...parameters, outerCorrespondence: parameters.outerCorrespondence.slice(1) },
  {
    ...parameters,
    outerCorrespondence: parameters.outerCorrespondence.map((track) => ({
      ...track,
      sectionEntityIds: [...track.sectionEntityIds, id(80)],
    })),
  },
  {
    ...parameters,
    outerCorrespondence: parameters.outerCorrespondence.map((track, index) =>
      index === 0 ? { ...track, sectionEntityIds: [id(50), id(51)] } : track,
    ),
  },
  { ...parameters, ruled: true },
])("rejects unconsumed or incompatible correspondence %j", (input) =>
  expect(loftFeatureContentParametersV3Schema.safeParse(input).success).toBe(false),
)
