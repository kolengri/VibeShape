import { describe, expect, it } from "bun:test"
import { lifecycleId as id } from "../../../tests/support/primitive-lifecycle"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import { localToolAnnotations, localToolDescriptions } from "./tool-metadata"

const parameters = {
  points: [
    [0, 0, 0],
    [30, 0, 0],
    [15, 20, 10],
  ],
  nodeRadius: 5,
  strutRadius: 2,
  connectionMode: "tree",
}
const args = {
  draftId: id(1),
  baseRevision: 3,
  commandId: id(2),
  featureId: id(3),
  label: "Mounting frame",
  suppressed: false,
  parameters,
}

describe("Connect Mounts public MCP contract", () => {
  it.each(["create_connect_mounts", "update_connect_mounts"] as const)(
    "exposes %s as an ordinary bounded owned-draft operation",
    (tool) => {
      expect(localOperationSchema.safeParse({ tool, arguments: args }).success).toBe(true)
      expect(
        localOperationSchema.safeParse({
          tool,
          arguments: { ...args, parameters: { ...parameters, connectionMode: "complete" } },
        }).success,
      ).toBe(true)
      expect(localToolDescriptions[tool]).toContain("draft")
      expect(localToolAnnotations(tool)).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      })
      expect(
        localToolOutputs[tool].safeParse({
          ok: false,
          diagnostic: { code: "not-paired", message: "No session", retryable: true },
        }).success,
      ).toBe(true)
      for (const extra of [
        { actor: {} },
        { documentId: id(4) },
        { dependencies: [] },
        { references: [] },
      ]) {
        expect(
          localOperationSchema.safeParse({ tool, arguments: { ...args, ...extra } }).success,
        ).toBe(false)
      }
      for (const invalid of [
        { points: [[0, 0, 0]] },
        {
          points: [
            [0, 0, 0],
            [0, 0, 0],
          ],
        },
        {
          points: [
            [0, 0, 0],
            [Infinity, 0, 0],
          ],
        },
        { nodeRadius: -1 },
        { strutRadius: 6 },
        { connectionMode: "optimized" },
        { points: Array.from({ length: 17 }, (_, i) => [i, 0, 0]) },
      ]) {
        expect(
          localOperationSchema.safeParse({
            tool,
            arguments: { ...args, parameters: { ...parameters, ...invalid } },
          }).success,
        ).toBe(false)
      }
    },
  )
})
