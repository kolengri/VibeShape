import { describe, expect, it } from "bun:test"
import { assertLocalExtensionEnvironment } from "./run-extension-evidence"

describe("extension evidence runner", () => {
  it("rejects every CI environment", () => {
    expect(() => assertLocalExtensionEnvironment({ CI: "false" })).toThrow("local-only")
    expect(() => assertLocalExtensionEnvironment({})).not.toThrow()
  })
})
