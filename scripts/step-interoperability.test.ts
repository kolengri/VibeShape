import { delimiter } from "node:path"
import { describe, expect, it } from "vitest"
import { GEOMETRY_PROTOCOL_VERSION } from "../packages/protocol/src"
import { OCCT_BUILD_INPUTS } from "./occt-build-config"
import {
  assertLocalStepInteroperabilityEnvironment,
  resolveFreeCadCommand,
  stepInteroperabilityReportSchema,
  stepProducerReportSchema,
} from "./step-interoperability"

describe("independent STEP evidence contract", () => {
  it("rejects CI execution", () => {
    expect(() => assertLocalStepInteroperabilityEnvironment({ CI: "true" })).toThrow(
      "Independent STEP evidence is local-only",
    )
    expect(() => assertLocalStepInteroperabilityEnvironment({})).not.toThrow()
  })

  it("resolves an explicit FreeCAD command before PATH candidates", () => {
    const environment = {
      PATH: ["/tools", "/fallback"].join(delimiter),
      VIBESHAPE_FREECAD_CMD: "/custom/freecadcmd",
    }

    expect(resolveFreeCadCommand(environment, (path) => path === "/custom/freecadcmd")).toBe(
      "/custom/freecadcmd",
    )
    expect(resolveFreeCadCommand({ PATH: "/tools" }, (path) => path === "/tools/freecadcmd")).toBe(
      "/tools/freecadcmd",
    )
    expect(() => resolveFreeCadCommand({ PATH: "/missing" }, () => false)).toThrow(
      "FreeCADCmd was not found",
    )
  })

  it("accepts only the pinned controlled producer", () => {
    const producerReport = {
      schemaVersion: 1,
      protocolVersion: GEOMETRY_PROTOCOL_VERSION,
      producer: {
        adapter: "replicad",
        adapterVersion: "spike-controlled-1",
        replicadVersion: "0.23.1",
        opencascadePackageVersion: `controlled-${OCCT_BUILD_INPUTS.sources.occt.revision.slice(0, 12)}`,
        opencascadeSourceRevision: OCCT_BUILD_INPUTS.sources.occt.revision,
        wasmBytes: 10_856_959,
        initializedInMs: 122,
      },
      shape: {
        valid: true,
        volume: 43_858,
        surfaceArea: 9_241,
        bounds: { min: [-30, -20, 0], max: [30, 20, 20] },
        faceCount: 12,
        edgeCount: 25,
        solidCount: 1,
      },
      step: { file: "vibeshape-kernel-fixture.step", bytes: 35_650, sha256: "a".repeat(64) },
    } as const

    expect(stepProducerReportSchema.safeParse(producerReport).success).toBe(true)
    expect(
      stepProducerReportSchema.safeParse({
        ...producerReport,
        producer: { ...producerReport.producer, adapterVersion: "spike-2" },
      }).success,
    ).toBe(false)
  })

  it("accepts only passing finite FreeCAD evidence", () => {
    const report = {
      schemaVersion: 1,
      reader: { name: "FreeCAD", version: "1.1.3", implementation: "Part.Shape.read" },
      input: { file: "vibeshape-kernel-fixture.step", bytes: 35_650, sha256: "a".repeat(64) },
      shape: {
        valid: true,
        volume: 43_858,
        surfaceArea: 9_241,
        bounds: { min: [-30, -20, 0], max: [30, 20, 20] },
        faceCount: 12,
        edgeCount: 25,
        solidCount: 1,
        shapeType: "Solid",
      },
      comparison: { relativeVolumeError: 0, maxBoundsDeltaMm: 0 },
      tolerances: { maximumRelativeVolumeError: 1e-8, maximumBoundsDeltaMm: 1e-5 },
      passed: true,
    } as const

    expect(stepInteroperabilityReportSchema.parse(report).passed).toBe(true)
    expect(stepInteroperabilityReportSchema.safeParse({ ...report, passed: false }).success).toBe(
      false,
    )
    expect(
      stepInteroperabilityReportSchema.safeParse({
        ...report,
        comparison: { ...report.comparison, relativeVolumeError: 1e-7 },
      }).success,
    ).toBe(false)
  })
})
