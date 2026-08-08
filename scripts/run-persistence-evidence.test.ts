import { describe, expect, it } from "vitest"
import { assertLocalPersistenceEnvironment } from "./run-persistence-evidence"

describe("persistence evidence runner", () => {
  it("rejects every CI environment", () => {
    expect(() => assertLocalPersistenceEnvironment({ CI: "false" })).toThrow("local-only")
    expect(() => assertLocalPersistenceEnvironment({})).not.toThrow()
  })
})
