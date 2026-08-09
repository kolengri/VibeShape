import { describe, expect, it } from "vitest"
import { applyDocumentCommand, reduceDocumentEvent, replayDocumentEvents } from "./commands"
import { createLengthQuantity } from "./units"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const variableIds = {
  width: "0195b5ac-b220-7a2c-8c33-67a36a7f21ac",
  depth: "0195b5ac-b221-7a2c-8c33-67a36a7f21ac",
} as const
const commandIds = [
  "0195b5ac-b230-7a2c-8c33-67a36a7f21ac",
  "0195b5ac-b231-7a2c-8c33-67a36a7f21ac",
  "0195b5ac-b232-7a2c-8c33-67a36a7f21ac",
  "0195b5ac-b233-7a2c-8c33-67a36a7f21ac",
] as const
const actor = { type: "user", userId: "org.vibeshape.user.alice" } as const

function envelope(kind: string, baseRevision: number, index: number) {
  return {
    kind,
    schemaVersion: 1,
    commandId: commandIds[index],
    documentId,
    baseRevision,
    issuedAt: `2026-08-08T12:0${index}:00Z`,
    actor,
  }
}

function createDocument() {
  const result = applyDocumentCommand(null, {
    ...envelope("org.vibeshape.document.create", 0, 0),
    payload: { name: "Configurable box" },
  })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

function addVariable(
  snapshot: ReturnType<typeof createDocument>["snapshot"],
  id: string,
  name: string,
  expression: string,
  index: number,
) {
  return applyDocumentCommand(snapshot, {
    ...envelope("org.vibeshape.variable.add", snapshot.revision, index),
    payload: { variable: { schemaVersion: 0, id, name, expression } },
  })
}

describe("variable document commands", () => {
  it("adds variables, updates an expression, and replays the exact semantic snapshot", () => {
    const created = createDocument()
    const width = addVariable(created.snapshot, variableIds.width, "width", "20 mm", 1)
    expect(width).toMatchObject({
      ok: true,
      snapshot: { revision: 2, variables: [{ name: "width", expression: "20 mm" }] },
      event: { type: "org.vibeshape.variable.added" },
    })
    if (!width.ok) return

    const depth = addVariable(width.snapshot, variableIds.depth, "depth", "#width / 2", 2)
    expect(depth).toMatchObject({ ok: true, snapshot: { revision: 3 } })
    if (!depth.ok) return

    const changed = applyDocumentCommand(depth.snapshot, {
      ...envelope("org.vibeshape.variable.set-expression", 3, 3),
      payload: { variableId: variableIds.width, expression: "24 mm" },
    })
    expect(changed).toMatchObject({
      ok: true,
      snapshot: {
        revision: 4,
        variables: [
          { name: "width", expression: "24 mm" },
          { name: "depth", expression: "#width / 2" },
        ],
      },
      event: {
        type: "org.vibeshape.variable.expression-changed",
        previousExpression: "20 mm",
        expression: "24 mm",
      },
    })
    if (!changed.ok) return

    expect(replayDocumentEvents([created.event, width.event, depth.event, changed.event])).toEqual({
      ok: true,
      snapshot: changed.snapshot,
    })
  })

  it("rejects duplicate identity, duplicate names, invalid dependencies, and no-op updates", () => {
    const created = createDocument()
    const width = addVariable(created.snapshot, variableIds.width, "width", "20 mm", 1)
    if (!width.ok) throw new Error(width.diagnostic.message)

    expect(addVariable(width.snapshot, variableIds.width, "other", "1 mm", 2)).toMatchObject({
      ok: false,
      diagnostic: { code: "variable-already-exists" },
    })
    expect(addVariable(width.snapshot, variableIds.depth, "width", "1 mm", 2)).toMatchObject({
      ok: false,
      diagnostic: { code: "variable-name-conflict" },
    })
    expect(addVariable(width.snapshot, variableIds.depth, "depth", "#missing", 2)).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-variable-expression" },
    })
    expect(
      applyDocumentCommand(width.snapshot, {
        ...envelope("org.vibeshape.variable.set-expression", 2, 2),
        payload: { variableId: variableIds.width, expression: "20 mm" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "command-no-op" } })
  })

  it("prevents deletion while another variable depends on the target", () => {
    const created = createDocument()
    const width = addVariable(created.snapshot, variableIds.width, "width", "20 mm", 1)
    if (!width.ok) throw new Error(width.diagnostic.message)
    const depth = addVariable(width.snapshot, variableIds.depth, "depth", "#width / 2", 2)
    if (!depth.ok) throw new Error(depth.diagnostic.message)

    expect(
      applyDocumentCommand(depth.snapshot, {
        ...envelope("org.vibeshape.variable.remove", 3, 3),
        payload: { variableId: variableIds.width },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "variable-in-use" } })
  })

  it("prevents deletion while a standard feature quantity references the variable", () => {
    const created = createDocument()
    const width = addVariable(created.snapshot, variableIds.width, "width", "20 mm", 1)
    if (!width.ok) throw new Error(width.diagnostic.message)
    const featured = applyDocumentCommand(width.snapshot, {
      ...envelope("org.vibeshape.feature.add", 2, 2),
      payload: {
        feature: {
          schemaVersion: 0,
          id: "0195b5ac-b250-7a2c-8c33-67a36a7f21ac",
          type: {
            moduleId: "org.example.features",
            moduleVersion: "1.0.0",
            typeId: "org.example.feature.block",
            schemaVersion: 1,
          },
          parameters: { width: createLengthQuantity(20, "mm", "#width") },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    })
    if (!featured.ok) throw new Error(featured.diagnostic.message)

    expect(
      applyDocumentCommand(featured.snapshot, {
        ...envelope("org.vibeshape.variable.remove", 3, 3),
        payload: { variableId: variableIds.width },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "variable-in-use",
        message: expect.stringContaining("feature parameter"),
      },
    })

    expect(
      applyDocumentCommand(featured.snapshot, {
        ...envelope("org.vibeshape.variable.replace-table", 3, 3),
        payload: { variables: [] },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "variable-in-use",
        message: expect.stringContaining("feature parameter"),
      },
    })
  })

  it("rejects tampered expression-change events", () => {
    const created = createDocument()
    const width = addVariable(created.snapshot, variableIds.width, "width", "20 mm", 1)
    if (!width.ok) throw new Error(width.diagnostic.message)
    const changed = applyDocumentCommand(width.snapshot, {
      ...envelope("org.vibeshape.variable.set-expression", 2, 2),
      payload: { variableId: variableIds.width, expression: "24 mm" },
    })
    if (!changed.ok || changed.event.type !== "org.vibeshape.variable.expression-changed") {
      throw new Error("Expected a variable expression event.")
    }

    expect(
      reduceDocumentEvent(width.snapshot, {
        ...changed.event,
        previousExpression: "19 mm",
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })

  it("replaces the exact table atomically regardless of visible dependency order", () => {
    const created = createDocument()
    const replaced = applyDocumentCommand(created.snapshot, {
      ...envelope("org.vibeshape.variable.replace-table", 1, 1),
      payload: {
        variables: [
          {
            schemaVersion: 0,
            id: variableIds.depth,
            name: "depth",
            expression: "#width / 2",
          },
          {
            schemaVersion: 0,
            id: variableIds.width,
            name: "width",
            expression: "20 mm",
          },
        ],
      },
    })

    expect(replaced).toMatchObject({
      ok: true,
      snapshot: {
        revision: 2,
        variables: [
          { name: "depth", expression: "#width / 2" },
          { name: "width", expression: "20 mm" },
        ],
      },
      event: { type: "org.vibeshape.variable.table-replaced", previousVariables: [] },
    })
    if (!replaced.ok) return
    expect(replayDocumentEvents([created.event, replaced.event])).toEqual({
      ok: true,
      snapshot: replaced.snapshot,
    })
  })

  it("keeps persisted variable names immutable across whole-table replacement", () => {
    const created = createDocument()
    const width = addVariable(created.snapshot, variableIds.width, "width", "20 mm", 1)
    if (!width.ok) throw new Error(width.diagnostic.message)

    expect(
      applyDocumentCommand(width.snapshot, {
        ...envelope("org.vibeshape.variable.replace-table", 2, 2),
        payload: {
          variables: [
            {
              schemaVersion: 0,
              id: variableIds.width,
              name: "renamedWidth",
              expression: "20 mm",
            },
          ],
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "variable-name-immutable" } })
  })
})
