import { describe, expect, it } from "bun:test"
import { featureForwardsDiagnosticMessage } from "./feature-diagnostic-messages"

const type = (name: string, schemaVersion: number) => ({
  typeId: `org.vibeshape.feature.part-design.${name}`,
  schemaVersion,
})

describe("featureForwardsDiagnosticMessage", () => {
  it.each([
    ["loft", 3],
    ["fillet", 1],
    ["fillet", 2],
    ["fillet", 3],
    ["draft", 1],
    ["scale", 1],
    ["thicken", 1],
    ["press-pull", 2],
  ] as const)("forwards %s v%s kernel messages", (name, version) => {
    expect(featureForwardsDiagnosticMessage(type(name, version))).toBe(true)
  })

  it.each([
    ["loft", 1],
    ["loft", 2],
    ["chamfer", 3],
    ["sweep", 1],
    ["shell", 2],
    ["press-pull", 1],
  ] as const)("keeps catalog advice for %s v%s", (name, version) => {
    expect(featureForwardsDiagnosticMessage(type(name, version))).toBe(false)
  })
})
