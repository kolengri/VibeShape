import { describe, expect, it } from "vitest"
import { instrumentReplicadBuildConfig } from "./occt-build-config"

const minimalUpstreamConfig = `mainBuild:
  name: replicad_single.js
  bindings:
  - symbol: GeomToolsWrapper
additionalCppCode: |
  class BRepToolsWrapper {
  };
`

describe("controlled OCCT build config", () => {
  it("adds allocator instrumentation without changing unrelated bindings", () => {
    const result = instrumentReplicadBuildConfig(minimalUpstreamConfig)

    expect(result).toContain("name: vibeshape_occt.js")
    expect(result).toContain("- symbol: GeomToolsWrapper\n  - symbol: VibeShapeAllocatorStats")
    expect(result).toContain("#include <malloc.h>")
    expect(result).toContain("static double AllocatedBytes()")
    expect(result).toContain("mallinfo().uordblks")
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
