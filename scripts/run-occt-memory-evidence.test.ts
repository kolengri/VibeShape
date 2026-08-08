import { describe, expect, it } from "vitest"
import {
  CONTROLLED_OCCT_EVIDENCE_RUNS,
  createControlledOcctEnvironment,
} from "./run-occt-memory-evidence"

describe("controlled OCCT evidence runner", () => {
  it("keeps the full and purge matrices aligned with the reviewed lifecycle contract", () => {
    expect(CONTROLLED_OCCT_EVIDENCE_RUNS).toEqual([
      {
        name: "allocator-instrumented geometry evidence",
        environment: {
          VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES: "5",
          VIBESHAPE_GEOMETRY_LIFECYCLE_ITERATIONS: "1000",
          VIBESHAPE_GEOMETRY_LIFECYCLE_OPERATIONS:
            "box,cylinder,boolean-cut,occt-box,occt-cylinder,occt-native-box,occt-native-cylinder",
        },
      },
      {
        name: "allocator purge control",
        environment: {
          VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES: "5",
          VIBESHAPE_GEOMETRY_LIFECYCLE_ITERATIONS: "1000",
          VIBESHAPE_GEOMETRY_LIFECYCLE_OPERATIONS:
            "occt-box,occt-cylinder,occt-native-box,occt-native-cylinder",
          VIBESHAPE_GEOMETRY_PURGE_AFTER_LIFECYCLE: "1",
        },
      },
    ])
  })

  it("enables the controlled artifact while preserving and overriding environment values", () => {
    expect(
      createControlledOcctEnvironment(
        { PATH: "/bin", VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES: "1" },
        { VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES: "5" },
      ),
    ).toEqual({
      PATH: "/bin",
      VIBESHAPE_CONTROLLED_OCCT: "1",
      VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES: "5",
    })
  })
})
