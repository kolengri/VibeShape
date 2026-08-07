import { describe, expect, it } from "vitest"

import { cn } from "./cn"

describe("cn", () => {
  it("keeps the last conflicting Tailwind utility", () => {
    expect(cn("px-2", false && "hidden", "px-4")).toBe("px-4")
  })
})
