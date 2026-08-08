import { describe, expect, it } from "vitest"

import { validationMessage } from "./validation-message"

describe(validationMessage.name, () => {
  it.each([
    ["Required", "Required"],
    [new Error("Invalid width"), "Invalid width"],
    [{ message: "Outside the print volume" }, "Outside the print volume"],
  ])("normalizes supported validation errors", (error, expected) => {
    expect(validationMessage(error)).toBe(expected)
  })

  it("does not fabricate a message for an unsupported validation value", () => {
    expect(validationMessage({ code: "invalid" })).toBeUndefined()
  })
})
