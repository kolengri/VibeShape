import { describe, expect, it } from "vitest"
import {
  assertIndependentConsumers,
  assertLocalThreeMfEnvironment,
  readConsumerGeometry,
  resolveThreeMfConsumers,
  sha256,
  type ThreeMfConsumer,
} from "./three-mf-evidence"

const prusa: ThreeMfConsumer = {
  name: "PrusaSlicer",
  family: "prusa",
  command: process.execPath,
  supportsDataDirectory: true,
}

const orca: ThreeMfConsumer = {
  name: "OrcaSlicer",
  family: "orca",
  command: process.execPath,
  supportsDataDirectory: true,
}

describe("3MF evidence utilities", () => {
  it("rejects every CI environment", () => {
    expect(() => assertLocalThreeMfEnvironment({ CI: "false" })).toThrow("local-only")
    expect(() => assertLocalThreeMfEnvironment({})).not.toThrow()
  })

  it("requires two slicers from independent families", () => {
    expect(() => assertIndependentConsumers([prusa, orca])).not.toThrow()
    expect(() => assertIndependentConsumers([orca, { ...orca, name: "Bambu Studio" }])).toThrow(
      "independent families",
    )
  })

  it("honors explicit consumer paths before platform defaults", () => {
    expect(
      resolveThreeMfConsumers({ VIBESHAPE_PRUSASLICER_BIN: process.execPath }, "linux"),
    ).toEqual([prusa])
  })

  it("produces lowercase SHA-256 digests", () => {
    expect(sha256("VibeShape")).toMatch(/^[a-f0-9]{64}$/)
  })

  it("accepts aggregate and per-object slicer geometry reports", () => {
    expect(
      readConsumerGeometry(`
        number_of_facets = 12
        manifold = yes
        volume = 960.000000
        number_of_facets = 12
        manifold = yes
        volume = 648.000000
      `),
    ).toEqual({ facetCount: 24, manifoldMeshCount: 2, volumeCubicMillimeters: 1_608 })
    expect(() =>
      readConsumerGeometry("number_of_facets = 24\nmanifold = no\nvolume = 1608"),
    ).toThrow("geometry mismatch")
  })
})
