import { automationDraftPreviewSchema } from "@vibeshape/automation-api/drafts"
import type { DraftReviewInput } from "@vibeshape/automation-host/host"
import { commandActorSchema, documentCommandSchema } from "@vibeshape/domain/commands"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { boxFeatureType, extrusionFeatureTypeV5 } from "@vibeshape/domain/part-design"
import { describe, expect, it } from "vitest"
import { mayAutoApplyCadReview } from "./session-auto-apply"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(1),
})
function input(): DraftReviewInput {
  const timestamp = new Date().toISOString()
  return {
    actor,
    commands: [
      documentCommandSchema.parse({
        kind: "org.vibeshape.feature.add",
        schemaVersion: 1,
        commandId: id(3),
        documentId: id(2),
        baseRevision: 1,
        issuedAt: timestamp,
        actor,
        payload: {
          feature: {
            schemaVersion: 0,
            id: id(4),
            type: boxFeatureType.type,
            parameters: {},
            dependencies: [],
            references: [],
            suppressed: false,
          },
        },
      }),
    ],
    preview: automationDraftPreviewSchema.parse({
      schemaVersion: 2,
      draft: {
        schemaVersion: 1,
        draftId: id(5),
        documentId: id(2),
        baseRevision: 1,
        revision: 2,
        commandCount: 1,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      summary: {
        kind: "org.vibeshape.document.summary",
        schemaVersion: 1,
        documentId: id(2),
        revision: 2,
        classification: "semantic",
        truncated: false,
        data: { name: "Part", createdAt: timestamp, updatedAt: timestamp },
      },
      geometry: {
        status: "valid",
        measurements: {
          kind: "org.vibeshape.model.measurements",
          schemaVersion: 1,
          documentId: id(2),
          revision: 2,
          generation: 1,
          classification: "derived",
          nextCursor: null,
          units: { length: "mm", area: "mm2", volume: "mm3" },
          data: { features: [], total: 0 },
        },
      },
    }),
  }
}

describe("session CAD auto-apply allowlist", () => {
  it.each([
    [5, true],
    [6, false],
  ] as const)("explicitly bounds independent extrusion schema version %i", (version, expected) => {
    const review = input()
    const command = review.commands[0]
    if (command?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature")
    const extrusion = documentCommandSchema.parse({
      ...command,
      payload: {
        feature: {
          ...command.payload.feature,
          type: { ...extrusionFeatureTypeV5.type, schemaVersion: version },
        },
      },
    })
    expect(mayAutoApplyCadReview({ ...review, commands: [extrusion] }, actor)).toBe(expected)
  })

  it.each(["suppressed", "extension", "type", "version", "missing"])(
    "keeps updates to a %s prior feature on manual review",
    (mode) => {
      const review = input()
      const addition = review.commands[0]
      if (addition?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature")
      const incoming = addition.payload.feature
      const previous = featureRecordSchema.parse({
        ...incoming,
        suppressed: mode === "suppressed",
        type: {
          ...incoming.type,
          ...(mode === "extension" ? { moduleId: "org.example.extension" } : {}),
          ...(mode === "type" ? { typeId: "org.vibeshape.feature.part-design.cylinder" } : {}),
          ...(mode === "version" ? { schemaVersion: 99 } : {}),
        },
      })
      const update = documentCommandSchema.parse({
        ...addition,
        kind: "org.vibeshape.feature.update",
      })
      expect(
        mayAutoApplyCadReview(
          { ...review, commands: [update] },
          actor,
          mode === "missing" ? [] : [previous],
        ),
      ).toBe(false)
      expect(mayAutoApplyCadReview({ ...review, commands: [update] }, actor, [incoming])).toBe(true)
    },
  )
  it("checks sequential add and update records without changing the base collection", () => {
    const review = input()
    const addition = review.commands[0]
    if (addition?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature")
    const update = documentCommandSchema.parse({
      ...addition,
      kind: "org.vibeshape.feature.update",
      commandId: id(8),
      baseRevision: 2,
      payload: { feature: { ...addition.payload.feature, parameters: { repaired: true } } },
    })
    expect(mayAutoApplyCadReview({ ...review, commands: [addition, update, update] }, actor)).toBe(
      true,
    )
    expect(mayAutoApplyCadReview({ ...review, commands: [update, addition] }, actor)).toBe(false)
    expect(mayAutoApplyCadReview({ ...review, commands: [addition, addition] }, actor)).toBe(false)
  })
  it("requires a matching MCP actor and valid nonempty geometry review", () => {
    const review = input()
    expect(mayAutoApplyCadReview(review, null)).toBe(false)
    expect(mayAutoApplyCadReview(review, actor)).toBe(true)
    expect(mayAutoApplyCadReview(review, { type: "user", userId: null })).toBe(false)
    expect(
      mayAutoApplyCadReview(review, commandActorSchema.parse({ ...actor, sessionId: id(6) })),
    ).toBe(false)
    expect(mayAutoApplyCadReview({ ...review, commands: [] }, actor)).toBe(false)
    review.preview.geometry.status = "invalid"
    expect(mayAutoApplyCadReview(review, actor)).toBe(false)
  })
  it.each(["actor", "document", "extension", "version", "suppressed"])(
    "fails closed for %s scope drift",
    (mode) => {
      const review = input()
      const command = review.commands[0]
      if (command?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature")
      const feature = command.payload.feature
      const altered = documentCommandSchema.parse({
        ...command,
        ...(mode === "actor" ? { actor: { type: "user", userId: null } } : {}),
        ...(mode === "document" ? { documentId: id(7) } : {}),
        payload: {
          feature: {
            ...feature,
            suppressed: mode === "suppressed",
            type: {
              ...feature.type,
              ...(mode === "extension" ? { moduleId: "org.example.extension" } : {}),
              ...(mode === "version" ? { schemaVersion: 99 } : {}),
            },
          },
        },
      })
      expect(mayAutoApplyCadReview({ ...review, commands: [altered] }, actor)).toBe(false)
    },
  )
  it.each([
    ["org.vibeshape.feature.remove", { featureId: id(4) }],
    ["org.vibeshape.feature.set-suppressed", { featureId: id(4), suppressed: false }],
    ["org.vibeshape.document.rename", { name: "Renamed" }],
    ["org.vibeshape.variable.remove", { variableId: id(4) }],
    ["org.vibeshape.variable.replace-table", { variables: [] }],
    ["org.vibeshape.sketch.remove", { sketchId: id(4) }],
  ])("keeps %s and mixed drafts on manual review", (kind, payload) => {
    const review = input()
    const command = documentCommandSchema.parse({ ...review.commands[0], kind, payload })
    expect(
      mayAutoApplyCadReview({ ...review, commands: [...review.commands, command] }, actor),
    ).toBe(false)
  })
})
