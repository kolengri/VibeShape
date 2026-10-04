import type { LoftFeatureContentParametersV3 } from "@vibeshape/protocol"
export const loftPatchTestId = (n: number) =>
  `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`
export function loftPatchContentFixture(): LoftFeatureContentParametersV3 {
  const id = loftPatchTestId
  const sections = [0, 10].map((z, column) => {
    const points: [number, number][] = [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ]
    const segments = points.map((start, i) => ({
      entityId: id(column * 10 + i + 1),
      type: "line" as const,
      startPointId: id(column * 10 + i + 100),
      endPointId: id(column * 10 + ((i + 1) % 4) + 100),
      start,
      end: points[(i + 1) % 4] as [number, number],
    }))
    return {
      sketchId: id(column + 200),
      frame: {
        origin: [0, 0, z] as [number, number, number],
        xAxis: [1, 0, 0] as [number, number, number],
        yAxis: [0, 1, 0] as [number, number, number],
        normal: [0, 0, 1] as [number, number, number],
      },
      outer: { sourceEntityIds: segments.map((s) => s.entityId), segments },
      holes: [],
    }
  })
  return {
    sections,
    ruled: false,
    outerCorrespondence: [0, 1, 2, 3].map((i) => ({
      sectionEntityIds: sections.map((s) => s.outer.segments[i]?.entityId ?? ""),
      sectionStartPointIds: sections.map((s) => s.outer.segments[i]?.startPointId ?? ""),
    })),
    rails: [],
    guides: [
      {
        name: "Wall guide",
        segmentTrack: 0,
        continuity: "C0",
        path: {
          sketchId: id(300),
          frame: {
            origin: [0, -2.0001, 0],
            xAxis: [1, 0, 0],
            yAxis: [0, 0, 1],
            normal: [0, -1, 0],
          },
          sourceEntityIds: [id(301)],
          startPointId: id(302),
          segments: [
            {
              entityId: id(301),
              type: "line",
              startPointId: id(302),
              endPointId: id(303),
              start: [-1, 5],
              end: [1, 5],
            },
          ],
        },
      },
    ],
    start: [],
    end: [],
  }
}
