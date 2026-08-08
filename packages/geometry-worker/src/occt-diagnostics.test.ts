import { describe, expect, it, vi } from "vitest"
import { purgeOcctAllocator, runNativeOcctLifecycleCycle } from "./occt-diagnostics"

function createDiagnosticsBinding() {
  return Object.assign(function Diagnostics() {}, {
    PurgeAllocator: vi.fn(() => 0),
    RunNativeBoxCycle: vi.fn(() => 1),
    RunNativeCylinderCycle: vi.fn(() => 1),
  })
}

describe("controlled OpenCascade diagnostics", () => {
  it("runs native scoped primitive cycles through the controlled binding", () => {
    const binding = createDiagnosticsBinding()
    const opencascade = { VibeShapeOcctDiagnostics: binding }

    runNativeOcctLifecycleCycle(opencascade, "box")
    runNativeOcctLifecycleCycle(opencascade, "cylinder")

    expect(binding.RunNativeBoxCycle).toHaveBeenCalledOnce()
    expect(binding.RunNativeCylinderCycle).toHaveBeenCalledOnce()
  })

  it("returns the number of blocks released by the OCCT memory manager", () => {
    const binding = createDiagnosticsBinding()
    binding.PurgeAllocator.mockReturnValue(12)

    expect(purgeOcctAllocator({ VibeShapeOcctDiagnostics: binding })).toBe(12)
  })

  it.each([undefined, {}, Object.assign(function Diagnostics() {}, { PurgeAllocator: 1 })])(
    "rejects an unavailable or malformed binding: %o",
    (binding) => {
      expect(() => purgeOcctAllocator({ VibeShapeOcctDiagnostics: binding })).toThrow(
        "Controlled OpenCascade lifecycle diagnostics are unavailable or malformed.",
      )
    },
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "rejects an invalid purge result: %s",
    (result) => {
      const binding = createDiagnosticsBinding()
      binding.PurgeAllocator.mockReturnValue(result)

      expect(() => purgeOcctAllocator({ VibeShapeOcctDiagnostics: binding })).toThrow(
        "OpenCascade diagnostic PurgeAllocator returned an invalid value.",
      )
    },
  )

  it("rejects a native lifecycle cycle that returns a null solid", () => {
    const binding = createDiagnosticsBinding()
    binding.RunNativeBoxCycle.mockReturnValue(0)

    expect(() => runNativeOcctLifecycleCycle({ VibeShapeOcctDiagnostics: binding }, "box")).toThrow(
      "Native OpenCascade box lifecycle cycle produced a null solid.",
    )
  })
})
