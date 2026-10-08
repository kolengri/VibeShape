import { describe, expect, it } from "bun:test"
import { documentSketchDisplaySchema } from "@vibeshape/protocol"
import { sweepLoftCatalogue } from "./sweep-loft-catalogue"
import { id, paths, snapshot } from "./sweep-loft-test-fixtures"

const copy = {
  profile: (sketch: string, number: number) => `${sketch} · Profile ${number}`,
  curve: (kind: "line" | "arc" | "cubic-bezier" | "elliptical-arc", number: number) =>
    `${kind} ${number}`,
  point: (number: number) => `Point ${number}`,
}
const loop = (entityId: string) => ({
  segments: [
    {
      entityId,
      type: "circle",
      reversed: false,
      samples: [
        [0, 0],
        [1, 0],
      ],
    },
  ],
})
const display = documentSketchDisplaySchema.parse({
  sketchId: id(1),
  curvePositions: new Float32Array(),
  constructionCurvePositions: new Float32Array(),
  pointPositions: new Float32Array(),
  constructionPointPositions: new Float32Array(),
  frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  profiles: [
    {
      selector: {
        schemaVersion: 0,
        sketchId: id(1),
        outerBoundaryEntityIds: [id(11)],
        holeBoundaryEntityIds: [[id(12)]],
      },
      outerLoop: loop(id(11)),
      holeLoops: [loop(id(12))],
    },
    {
      selector: {
        schemaVersion: 0,
        sketchId: id(1),
        outerBoundaryEntityIds: [id(13)],
        holeBoundaryEntityIds: [],
      },
      outerLoop: loop(id(13)),
      holeLoops: [],
    },
  ],
})

describe("Sweep and Loft authoritative selection catalogue", () => {
  it("retains holed Sweep and Loft profiles without renumbering solved regions", () => {
    const sweep = sweepLoftCatalogue(snapshot, [display], [], "sweep", copy)
    expect(sweep.profiles).toHaveLength(2)
    expect(sweep.profiles[0]?.selector.holeBoundaryEntityIds).toEqual<unknown>([[id(12)]])
    const loft = sweepLoftCatalogue(snapshot, [display], [], "loft", copy)
    expect(loft.profiles.map(({ label }) => label)).toEqual([
      "Sketch 1 · Profile 1",
      "Sketch 1 · Profile 2",
    ])
  })

  it("excludes sketches that would create forward dependencies", () => {
    expect(sweepLoftCatalogue(snapshot, [display], [id(1)], "sweep", copy).profiles).toEqual([])
  })

  it("offers only authored curves with both authoritative solved endpoints", () => {
    const pathDisplay = documentSketchDisplaySchema.parse({
      ...display,
      sketchId: paths[0]?.sketch.id,
      profiles: [],
      solvedPoints: [
        { entityId: id(30), position: [0, 0, 0] },
        { entityId: id(31), position: [0, 0, 10] },
      ],
    })
    const catalogue = sweepLoftCatalogue(snapshot, [pathDisplay], [], "sweep", copy)
    expect(catalogue.paths[0]?.curves.map(({ id: entityId }) => entityId)).toEqual<unknown>([
      id(41),
    ])
    expect(catalogue.paths[0]?.points.map(({ id: pointId }) => pointId)).toEqual<unknown>([
      id(30),
      id(31),
    ])
  })
})
