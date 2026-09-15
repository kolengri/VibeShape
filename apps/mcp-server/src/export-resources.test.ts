import { describe, expect, it } from "vitest"
import { createExportResources } from "./export-resources"

const file = {
  documentId: "0195b5ac-b250-7a2c-8c33-000000000001",
  revision: 1,
  format: "step",
  filename: "model.step",
  mimeType: "model/step",
  base64: "U1RFUA==",
} as const

describe("session export resources", () => {
  it("evicts old exports, expires links, and drops all content on revocation", () => {
    let now = 1000
    const resources = createExportResources(() => now)
    const first = resources.add(file)
    const second = resources.add(file)
    resources.add(file)
    resources.add(file)
    resources.add(file)
    expect(resources.read(first.uri)).toBeNull()
    expect(resources.read(second.uri)?.blob).toBe("U1RFUA==")
    now += 300_000
    expect(resources.read(second.uri)).toBeNull()
    const current = resources.add(file)
    resources.clear()
    expect(resources.read(current.uri)).toBeNull()
  })
})
