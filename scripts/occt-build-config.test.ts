import { describe, expect, it } from "vitest"
import { CONTROLLED_OCCT_SOURCE_REVISION } from "../packages/geometry-worker/src/build-info"
import { instrumentReplicadBuildConfig, OCCT_BUILD_INPUTS } from "./occt-build-config"

const minimalUpstreamConfig = `mainBuild:
  name: replicad_single.js
  bindings:
  - symbol: GeomToolsWrapper
additionalCppCode: |
  class BRepToolsWrapper {
  };
`

describe("controlled OCCT build config", () => {
  it("keeps runtime provenance aligned with the pinned OCCT input", () => {
    expect(CONTROLLED_OCCT_SOURCE_REVISION).toBe(OCCT_BUILD_INPUTS.sources.occt.revision)
  })

  it("pins every source-builder input and the registry comparison baseline", () => {
    expect(OCCT_BUILD_INPUTS.sourceBuilder.emscriptenImage).toMatch(
      /^emscripten\/emsdk@sha256:[a-f0-9]{64}$/,
    )
    expect(OCCT_BUILD_INPUTS.sourceBuilder.pythonPackages).toEqual([
      "argparse==1.4.0",
      "cerberus==1.3.4",
      "libclang==15.0.6.1",
      "pyyaml==6.0",
    ])
    expect(OCCT_BUILD_INPUTS.sources.rapidjson.sha256).toHaveLength(64)
    expect(OCCT_BUILD_INPUTS.sources.freetype.sha256).toHaveLength(64)
    expect(Object.keys(OCCT_BUILD_INPUTS.sourceBuilder.registryBaselineOutputs)).toEqual([
      "vibeshape_occt.js",
      "vibeshape_occt.wasm",
      "vibeshape_occt.d.ts",
    ])
  })

  it("adds allocator and native lifecycle instrumentation without changing unrelated bindings", () => {
    const result = instrumentReplicadBuildConfig(minimalUpstreamConfig)

    expect(result).toContain("name: vibeshape_occt.js")
    expect(result).toContain(
      "- symbol: GeomToolsWrapper\n  - symbol: VibeShapeAllocatorStats\n  - symbol: VibeShapeOcctDiagnostics",
    )
    expect(result).toContain("#include <malloc.h>")
    expect(result).toContain("#include <Standard.hxx>")
    expect(result).toContain("static double AllocatedBytes()")
    expect(result).toContain("mallinfo().uordblks")
    expect(result).toContain("static double PurgeAllocator()")
    expect(result).toContain("static double RunNativeBoxCycle()")
    expect(result).toContain("static double RunNativeCylinderCycle()")
    expect(result).toContain("class BRepToolsWrapper")
  })

  it("rejects an upstream config whose reviewed anchors changed", () => {
    expect(() => instrumentReplicadBuildConfig("mainBuild: {}\n")).toThrow(
      "Expected exactly one OCCT build-config anchor",
    )
  })

  it("rejects duplicate anchors instead of patching an ambiguous config", () => {
    expect(() =>
      instrumentReplicadBuildConfig(`${minimalUpstreamConfig}\n${minimalUpstreamConfig}`),
    ).toThrow("Expected exactly one OCCT build-config anchor")
  })
})
