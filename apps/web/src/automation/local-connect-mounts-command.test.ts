import { describe, expect, it } from "bun:test"
import {
  isLocalPrimitiveCommand,
  localOperationSchema,
} from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, parseDocumentCommand } from "@vibeshape/domain"
import { lifecycleId as id } from "../../../../tests/support/primitive-lifecycle"
import { createLocalPrimitiveCommand } from "./local-primitive-command"

const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.connector",
  sessionId: id(1),
})
const parameters = {
  points: [
    [0, 0, 0],
    [20, 0, 0],
  ],
  nodeRadius: 4,
  strutRadius: 2,
  connectionMode: "tree",
}

describe("Connect Mounts named command authority", () => {
  it.each(["create_connect_mounts", "update_connect_mounts"] as const)(
    "routes %s through revision-safe domain commands",
    (tool) => {
      const operation = localOperationSchema.parse({
        tool,
        arguments: {
          draftId: id(2),
          baseRevision: 7,
          commandId: id(3),
          featureId: id(4),
          label: "Connector",
          suppressed: false,
          parameters,
        },
      })
      if (!isLocalPrimitiveCommand(operation))
        throw new Error("Expected registered feature operation")
      const request = createLocalPrimitiveCommand(operation, actor, id(5))
      expect(parseDocumentCommand(request.command).ok).toBe(true)
      expect(request).toMatchObject({
        draftId: id(2),
        command: {
          kind: tool.startsWith("create_")
            ? "org.vibeshape.feature.add"
            : "org.vibeshape.feature.update",
          actor,
          documentId: id(5),
          baseRevision: 7,
          commandId: id(3),
          payload: {
            feature: {
              id: id(4),
              type: {
                typeId: "org.vibeshape.feature.part-design.connect-mounts",
                schemaVersion: 1,
              },
              parameters,
              dependencies: [],
              references: [],
              suppressed: false,
            },
          },
        },
      })
    },
  )
})
