import { describe, expect, it } from "vitest"
import { assertRegistryBaseline } from "./build-occt-source-builder"
import { OCCT_BUILD_INPUTS } from "./occt-build-config"

function createBaselineOutputs() {
  return Object.entries(OCCT_BUILD_INPUTS.sourceBuilder.registryBaselineOutputs).map(
    ([file, output]) => ({ file, ...output }),
  )
}

describe(assertRegistryBaseline.name, () => {
  it("accepts the exact registry-built output manifest", () => {
    expect(() => assertRegistryBaseline(createBaselineOutputs())).not.toThrow()
  })

  it("rejects changed output bytes or hashes", () => {
    const outputs = createBaselineOutputs()
    const first = outputs[0]

    if (!first) {
      throw new Error("The registry baseline fixture is empty.")
    }

    expect(() =>
      assertRegistryBaseline([{ ...first, bytes: first.bytes + 1 }, ...outputs.slice(1)]),
    ).toThrow("does not match the registry baseline")
  })

  it("rejects a missing output", () => {
    expect(() => assertRegistryBaseline(createBaselineOutputs().slice(1))).toThrow(
      "output count does not match",
    )
  })
})
