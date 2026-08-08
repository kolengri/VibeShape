import { describe, expect, it } from "vitest"
import { assertLocalTopologyEnvironment } from "./run-topology-evidence"

describe("stable topology evidence runner", () => {
  it("rejects every CI environment before starting Playwright", () => {
    expect(() => assertLocalTopologyEnvironment({ CI: "true" })).toThrow(
      "Stable topology evidence is local-only",
    )
    expect(() => assertLocalTopologyEnvironment({})).not.toThrow()
  })
})
