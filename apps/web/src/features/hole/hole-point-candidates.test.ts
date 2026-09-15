import type { SketchDisplayRecord } from "@vibeshape/application/sketch-display"
import { sketchEntityIdSchema, sketchIdSchema, sketchRecordSchema } from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { holePointCandidates } from "./hole-point-candidates"

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4801")
const firstPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4802")
const constructionPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4803")
const secondPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4804")
const externalPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4805")

const sketch = sketchRecordSchema.parse({
  schemaVersion: 0,
  id: sketchId,
  label: "Hole centers",
  plane: "xy",
  entities: [
    { schemaVersion: 0, id: firstPointId, type: "point", x: -1, y: -2, construction: false },
    {
      schemaVersion: 0,
      id: constructionPointId,
      type: "point",
      x: -3,
      y: -4,
      construction: true,
    },
    { schemaVersion: 0, id: secondPointId, type: "point", x: -5, y: -6, construction: false },
  ],
  constraints: [],
})

function display(
  solvedPoints: {
    entityId: typeof firstPointId
    position: [number, number, number]
  }[],
): SketchDisplayRecord {
  return {
    sketchId,
    curvePositions: new Float32Array(),
    constructionCurvePositions: new Float32Array(),
    pointPositions: new Float32Array(),
    constructionPointPositions: new Float32Array(),
    solvedPoints,
    frame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    },
    profiles: [],
  }
}

const label = (ordinal: number, id: string) => `Point ${ordinal}: ${id}`

describe("Hole point candidates", () => {
  it("uses authoritative solved world positions instead of authored coordinates", () => {
    const candidates = holePointCandidates(
      sketch,
      display([
        { entityId: firstPointId, position: [101, 102, 103] },
        { entityId: constructionPointId, position: [201, 202, 203] },
        { entityId: secondPointId, position: [301, 302, 303] },
      ]),
      [secondPointId],
      label,
    )

    expect(candidates).toEqual([
      expect.objectContaining({ sourcePointId: firstPointId, position: [101, 102, 103] }),
      expect.objectContaining({
        sourcePointId: constructionPointId,
        position: [201, 202, 203],
      }),
      expect.objectContaining({
        sourcePointId: secondPointId,
        position: [301, 302, 303],
        selected: true,
      }),
    ])
  })

  it("keeps construction points correctly identified and rejects appended external identities", () => {
    expect(
      holePointCandidates(
        sketch,
        display([
          { entityId: firstPointId, position: [1, 2, 3] },
          { entityId: constructionPointId, position: [4, 5, 6] },
          { entityId: secondPointId, position: [7, 8, 9] },
        ]),
        [],
        label,
      )?.map(({ sourcePointId }) => sourcePointId),
    ).toEqual([firstPointId, constructionPointId, secondPointId])
    expect(
      holePointCandidates(
        sketch,
        display([
          { entityId: firstPointId, position: [1, 2, 3] },
          { entityId: constructionPointId, position: [4, 5, 6] },
          { entityId: externalPointId, position: [7, 8, 9] },
        ]),
        [],
        label,
      ),
    ).toBeNull()
  })

  it("fails closed for incomplete, duplicate, and malformed solved-point metadata", () => {
    expect(
      holePointCandidates(
        sketch,
        display([
          { entityId: firstPointId, position: [1, 2, 3] },
          { entityId: secondPointId, position: [4, 5, 6] },
        ]),
        [],
        label,
      ),
    ).toBeNull()
    expect(
      holePointCandidates(
        sketch,
        display([
          { entityId: firstPointId, position: [1, 2, 3] },
          { entityId: firstPointId, position: [4, 5, 6] },
          { entityId: secondPointId, position: [7, 8, Number.NaN] },
        ]),
        [],
        label,
      ),
    ).toBeNull()
  })
})
