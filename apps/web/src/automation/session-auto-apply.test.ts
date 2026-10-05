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

describe("session CAD auto-apply scope", () => {
  it.each([
    ["org.vibeshape.feature.remove", { featureId: id(4) }],
    ["org.vibeshape.sketch.remove", { sketchId: id(4) }],
    ["org.vibeshape.feature.set-suppressed", { featureId: id(4), suppressed: false }],
  ] as const)("auto-applies CAD lifecycle command %s with a valid grant", (kind, payload) => {
    const review = input()
    const command = review.commands[0]
    if (command?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature.")
    const lifecycle = documentCommandSchema.parse({ ...command, kind, payload })
    expect(
      mayAutoApplyCadReview({ ...review, commands: [lifecycle] }, actor, [command.payload.feature]),
    ).toBe(true)
    expect(mayAutoApplyCadReview({ ...review, commands: [command, lifecycle] }, actor)).toBe(true)
  })
  it.each([
    ["union", 2, true],
    ["union", 1, true],
    ["union", 3, false],
    ["loft", 1, true],
    ["loft", 2, true],
    ["loft", 3, true],
    ["loft", 4, false],
    ["compound", 1, true],
    ["compound", 2, true],
    ["sweep", 1, true],
    ["cone", 1, true],
    ["sphere", 1, true],
    ["torus", 1, true],
    ["pyramid", 1, true],
    ["mirror", 1, true],
    ["mirror", 2, true],
    ["mirror", 3, true],
    ["mirror", 4, false],
    ["shell", 1, true],
    ["shell", 2, true],
    ["shell", 3, false],
    ["pattern", 2, true],
    ["split", 2, true],
    ["placement", 1, true],
    ["thread", 2, true],
    ["revolve", 7, true],
    ["hole", 3, true],
    ["boolean", 2, true],
    ["imported", 1, false],
    ["imported-mesh", 1, false],
    ["unknown", 1, false],
  ] as const)("bounds %s schema version %i to shipped CAD contracts", (name, version, expected) => {
    const review = input()
    const addition = review.commands[0]
    if (addition?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature")
    const command = documentCommandSchema.parse({
      ...addition,
      payload: {
        feature: {
          ...addition.payload.feature,
          type: {
            moduleId: "org.vibeshape.core.part-design",
            moduleVersion: "0.1.0",
            typeId: `org.vibeshape.feature.part-design.${name}`,
            schemaVersion: version,
          },
        },
      },
    })
    expect(mayAutoApplyCadReview({ ...review, commands: [command] }, actor)).toBe(expected)
    expect(mayAutoApplyCadReview({ ...review, commands: [command] }, null)).toBe(false)
  })

  it.each(["union", "loft"] as const)(
    "keeps %s actor, geometry and update-version authority bounded",
    (name) => {
      const review = input()
      const addition = review.commands[0]
      if (addition?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature")
      const command = documentCommandSchema.parse({
        ...addition,
        payload: {
          feature: {
            ...addition.payload.feature,
            type: {
              ...addition.payload.feature.type,
              typeId: `org.vibeshape.feature.part-design.${name}`,
              schemaVersion: name === "union" ? 2 : 1,
            },
          },
        },
      })
      if (command.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature addition")
      expect(mayAutoApplyCadReview({ ...review, commands: [command] }, actor)).toBe(true)
      expect(
        mayAutoApplyCadReview(
          { ...review, commands: [command] },
          commandActorSchema.parse({ ...actor, sessionId: id(9) }),
        ),
      ).toBe(false)
      const update = documentCommandSchema.parse({
        ...command,
        kind: "org.vibeshape.feature.update",
      })
      expect(
        mayAutoApplyCadReview({ ...review, commands: [update] }, actor, [command.payload.feature]),
      ).toBe(true)
      expect(
        mayAutoApplyCadReview({ ...review, commands: [update] }, actor, [
          featureRecordSchema.parse({
            ...command.payload.feature,
            type: { ...command.payload.feature.type, schemaVersion: 99 },
          }),
        ]),
      ).toBe(false)
      review.preview.geometry.status = "invalid"
      expect(mayAutoApplyCadReview({ ...review, commands: [command] }, actor)).toBe(false)
    },
  )
  it.each([
    [5, true],
    [6, true],
    [7, true],
    [8, false],
  ] as const)("bounds extrusion schema version %i to the shipped host", (version, expected) => {
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

  it.each(["extension", "type", "version", "missing"])(
    "keeps updates to a %s prior feature on manual review",
    (mode) => {
      const review = input()
      const addition = review.commands[0]
      if (addition?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature")
      const incoming = addition.payload.feature
      const previous = featureRecordSchema.parse({
        ...incoming,
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
  it.each(["actor", "document", "extension", "version", "module-version"])(
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
            type: {
              ...feature.type,
              ...(mode === "extension" ? { moduleId: "org.example.extension" } : {}),
              ...(mode === "version" ? { schemaVersion: 99 } : {}),
              ...(mode === "module-version" ? { moduleVersion: "99.0.0" } : {}),
            },
          },
        },
      })
      expect(mayAutoApplyCadReview({ ...review, commands: [altered] }, actor)).toBe(false)
    },
  )
  it.each([
    ["org.vibeshape.document.rename", { name: "Renamed" }],
    ["org.vibeshape.document.set-display-units", { displayUnits: { length: "mm", angle: "deg" } }],
    ["org.vibeshape.document.create", { name: "Other project" }],
  ])("keeps %s and mixed drafts on manual review", (kind, payload) => {
    const review = input()
    const command = documentCommandSchema.parse({ ...review.commands[0], kind, payload })
    expect(
      mayAutoApplyCadReview({ ...review, commands: [...review.commands, command] }, actor),
    ).toBe(false)
  })
  it.each([
    ["org.vibeshape.variable.rename", { variableId: id(4), name: "thickness" }],
    ["org.vibeshape.variable.remove", { variableId: id(4) }],
    ["org.vibeshape.variable.replace-table", { variables: [] }],
  ])("covers %s within a CAD draft", (kind, payload) => {
    const review = input()
    const command = documentCommandSchema.parse({ ...review.commands[0], kind, payload })
    expect(mayAutoApplyCadReview({ ...review, commands: [command] }, actor)).toBe(true)
  })
  it("allows supported schema upgrades and explicit suppression without mutating the base", () => {
    const review = input()
    const addition = review.commands[0]
    if (addition?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature.")
    const previous = featureRecordSchema.parse({
      ...addition.payload.feature,
      suppressed: true,
      type: { ...extrusionFeatureTypeV5.type, schemaVersion: 5 },
    })
    const update = documentCommandSchema.parse({
      ...addition,
      kind: "org.vibeshape.feature.update",
      payload: { feature: { ...previous, type: { ...previous.type, schemaVersion: 6 } } },
    })
    const unsuppress = documentCommandSchema.parse({
      ...addition,
      kind: "org.vibeshape.feature.set-suppressed",
      payload: { featureId: previous.id, suppressed: false },
    })
    expect(
      mayAutoApplyCadReview({ ...review, commands: [update, unsuppress] }, actor, [previous]),
    ).toBe(true)
    expect(previous.suppressed).toBe(true)
    expect(previous.type.schemaVersion).toBe(5)
  })
  it.each(["extension", "imported", "imported-mesh", "version", "missing"])(
    "keeps lifecycle changes to %s targets outside the CAD grant",
    (mode) => {
      const review = input()
      const addition = review.commands[0]
      if (addition?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature.")
      const previous = featureRecordSchema.parse({
        ...addition.payload.feature,
        type: {
          ...addition.payload.feature.type,
          ...(mode === "extension" ? { moduleId: "org.example.extension" } : {}),
          ...(mode === "version" ? { schemaVersion: 99 } : {}),
          ...(mode === "imported" || mode === "imported-mesh"
            ? { typeId: `org.vibeshape.feature.part-design.${mode}` }
            : {}),
        },
      })
      for (const [kind, payload] of [
        ["org.vibeshape.feature.remove", { featureId: previous.id }],
        ["org.vibeshape.feature.set-suppressed", { featureId: previous.id, suppressed: false }],
      ]) {
        const command = documentCommandSchema.parse({ ...addition, kind, payload })
        expect(
          mayAutoApplyCadReview(
            { ...review, commands: [command] },
            actor,
            mode === "missing" ? [] : [previous],
          ),
        ).toBe(false)
      }
    },
  )
  it("tracks removals and rejects unsupported command versions", () => {
    const review = input()
    const addition = review.commands[0]
    if (addition?.kind !== "org.vibeshape.feature.add") throw new Error("Missing feature.")
    const removal = documentCommandSchema.parse({
      ...addition,
      kind: "org.vibeshape.feature.remove",
      payload: { featureId: addition.payload.feature.id },
    })
    expect(
      mayAutoApplyCadReview({ ...review, commands: [addition, removal, addition] }, actor),
    ).toBe(true)
    expect(
      mayAutoApplyCadReview({ ...review, commands: [addition, removal, removal] }, actor),
    ).toBe(false)
    expect(
      mayAutoApplyCadReview(
        { ...review, commands: [{ ...addition, schemaVersion: 99 } as unknown as typeof addition] },
        actor,
      ),
    ).toBe(false)
  })
})
