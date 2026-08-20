import {
  boxFeatureType,
  createLengthQuantity,
  datumPlaneFeatureType,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { describe, expect, it } from "vitest"
import { terminalFeatureIds } from "./terminal-features"

const boxId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2711")
const datumId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2712")
const box = featureRecordSchema.parse({
  schemaVersion: 0,
  id: boxId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20),
    depth: createLengthQuantity(20),
    height: createLengthQuantity(20),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
})
const datum = featureRecordSchema.parse({
  schemaVersion: 0,
  id: datumId,
  type: datumPlaneFeatureType.type,
  parameters: {
    mode: "offset",
    support: { kind: "origin-plane", plane: "xy" },
    offset: createLengthQuantity(10),
  },
  dependencies: [],
  references: [],
  suppressed: false,
})

describe("terminal body features", () => {
  it("keeps reference geometry out of terminal body ownership", () => {
    expect([...terminalFeatureIds([box, datum])]).toEqual([boxId])
  })
})
