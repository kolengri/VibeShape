import { describe, expect, it } from "bun:test"
import { lifecycleId as id } from "../../../tests/support/primitive-lifecycle"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import { localToolAnnotations, localToolDescriptions } from "./tool-metadata"

const quantity = (
  value: number,
  dimension = "length",
  unit = "mm",
  expression: string | null = null,
) => ({
  schemaVersion: 0,
  dimension,
  value,
  unit,
  source: { value, unit, expression },
})
const helix = {
  axis: { kind: "datum-axis", featureId: id(9), axis: "normal" },
  handedness: "left",
  radius: quantity(10, "length", "mm", "#r"),
  pitch: quantity(5),
  extent: { kind: "turns", turns: quantity(3, "scalar", "1") },
  startAngle: quantity(0, "angle", "rad"),
}
const coil = {
  ...helix,
  section: { kind: "rectangular", width: quantity(2), height: quantity(1) },
  operation: "remove",
  targetBody: { schemaVersion: 0, featureId: id(8), outputRole: "result" },
}
const command = {
  draftId: id(1),
  baseRevision: 2,
  commandId: id(2),
  featureId: id(3),
  label: "Coil 1",
  suppressed: false,
  references: [],
}

describe("Coil and helical Sweep public MCP contract", () => {
  it.each(["create_coil", "update_coil"] as const)(
    "accepts %s with canonical target-first dependencies",
    (tool) => {
      const args = { ...command, dependencies: [id(8), id(9)], parameters: coil }
      expect(localOperationSchema.safeParse({ tool, arguments: args }).success).toBe(true)
      for (const invalid of [
        { ...args, dependencies: [id(9), id(8)] },
        { ...args, dependencies: [id(8)] },
        { ...args, parameters: { ...coil, targetBody: null } },
        { ...args, parameters: { ...coil, pitch: quantity(0.5) } },
        { ...args, parameters: { ...coil, flatEnds: true } },
      ])
        expect(localOperationSchema.safeParse({ tool, arguments: invalid }).success).toBe(false)
      expect(
        localOperationSchema.safeParse({
          tool,
          arguments: {
            ...args,
            dependencies: [id(9)],
            parameters: { ...coil, operation: "new", targetBody: null },
          },
        }).success,
      ).toBe(true)
      expect(localToolDescriptions[tool]).toContain("draft")
      expect(localToolAnnotations(tool)).toMatchObject({ readOnlyHint: false })
      expect(localToolOutputs[tool]).toBeDefined()
    },
  )

  it("accepts a helix path on the existing sweep tools and keeps planar v1 bounds", () => {
    const profile = {
      schemaVersion: 0,
      sketchId: id(20),
      outerBoundaryEntityIds: [id(21)],
      holeBoundaryEntityIds: [],
    }
    const args = {
      ...command,
      dependencies: [id(9)],
      parameters: { profile, path: { kind: "helix", ...helix } },
    }
    expect(localOperationSchema.safeParse({ tool: "create_sweep", arguments: args }).success).toBe(
      true,
    )
    expect(
      localOperationSchema.safeParse({
        tool: "update_sweep",
        arguments: { ...args, dependencies: [] },
      }).success,
    ).toBe(false)
    expect(localToolDescriptions.create_sweep).toContain("helix")
  })
})
