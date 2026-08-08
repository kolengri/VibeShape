import { describe, expect, it } from "vitest"
import { assertRegistryBaseline } from "./build-occt-source-builder"

function createBaselineOutputs() {
  return [
    { file: "vibeshape_occt.js", bytes: 10, sha256: "a".repeat(64) },
    { file: "vibeshape_occt.wasm", bytes: 20, sha256: "b".repeat(64) },
    { file: "vibeshape_occt.d.ts", bytes: 30, sha256: "c".repeat(64) },
  ]
}

describe(assertRegistryBaseline.name, () => {
  it("accepts the registry output dimensions with diagnostic hashes", () => {
    const registry = createBaselineOutputs()
    const source = registry.map((output) =>
      output.file.endsWith(".wasm") ? { ...output, sha256: "d".repeat(64) } : output,
    )

    expect(() => assertRegistryBaseline(registry, source)).not.toThrow()
  })

  it("rejects changed output dimensions", () => {
    const outputs = createBaselineOutputs()
    const first = outputs[0]

    if (!first) {
      throw new Error("The registry baseline fixture is empty.")
    }

    expect(() =>
      assertRegistryBaseline(outputs, [{ ...first, bytes: first.bytes + 1 }, ...outputs.slice(1)]),
    ).toThrow("does not match the registry output contract")
  })

  it("rejects a missing output", () => {
    expect(() =>
      assertRegistryBaseline(createBaselineOutputs(), createBaselineOutputs().slice(1)),
    ).toThrow("output count does not match")
  })

  it("rejects changed JavaScript or declaration content", () => {
    const registry = createBaselineOutputs()
    const source = registry.map((output) =>
      output.file.endsWith(".js") ? { ...output, sha256: "d".repeat(64) } : output,
    )

    expect(() => assertRegistryBaseline(registry, source)).toThrow(
      "does not match the registry output contract",
    )
  })
})
