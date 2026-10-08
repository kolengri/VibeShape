import { describe, expect, it } from "bun:test"
import { assertLocalTopologyEnvironment } from "./run-topology-evidence"

describe("stable topology evidence runner", () => {
  it("rejects every CI environment before starting Playwright", () => {
    expect(() => assertLocalTopologyEnvironment({ CI: "true" })).toThrow(
      "Stable topology evidence is local-only",
    )
    expect(() => assertLocalTopologyEnvironment({})).not.toThrow()
  })
})
