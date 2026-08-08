import { describe, expect, it } from "vitest"
import { assertSuccessfulOcctProcess } from "./occt-process"

describe("OCCT child process validation", () => {
  it("accepts a successful command", () => {
    expect(() => assertSuccessfulOcctProcess({ status: 0 }, "OCCT command")).not.toThrow()
  })

  it("preserves launch and exit diagnostics", () => {
    expect(() =>
      assertSuccessfulOcctProcess({ error: new Error("unavailable"), status: null }, "Bun"),
    ).toThrow("Bun failed to start: unavailable")
    expect(() => assertSuccessfulOcctProcess({ status: 7 }, "OCCT command")).toThrow(
      "OCCT command exited with status 7.",
    )
  })
})
