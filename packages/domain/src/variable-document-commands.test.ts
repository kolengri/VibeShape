import { describe, expect, it } from "vitest"
import { applyDocumentCommand, reduceDocumentEvent, replayDocumentEvents } from "./commands"
import { sketchConstraintIdSchema, sketchEntityIdSchema, sketchIdSchema } from "./identifiers"
import { boxFeatureType } from "./part-design"
import { createRectangleSketch } from "./rectangle-sketch"
import { createLengthQuantity } from "./units"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const variableIds = {
  width: "0195b5ac-b220-7a2c-8c33-67a36a7f21ac",
  depth: "0195b5ac-b221-7a2c-8c33-67a36a7f21ac",
} as const
const featureId = "0195b5ac-b222-7a2c-8c33-67a36a7f21ac"
const commandIds = [
  "0195b5ac-b230-7a2c-8c33-67a36a7f21ac",
  "0195b5ac-b231-7a2c-8c33-67a36a7f21ac",
  "0195b5ac-b232-7a2c-8c33-67a36a7f21ac",
  "0195b5ac-b233-7a2c-8c33-67a36a7f21ac",
  "0195b5ac-b234-7a2c-8c33-67a36a7f21ac",
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

function sequentialIdFactory<Value>(parse: (value: string) => Value, group: string) {
  let index = 0
  return () => {
    index += 1
    return parse(`0195b5ac-${group}-7a2c-8c33-${index.toString(16).padStart(12, "0")}`)
  }
}

function variableDrivenSketch() {
  return createRectangleSketch({
    id: sketchIdSchema.parse("0195b5ac-b225-7a2c-8c33-67a36a7f21ac"),
    label: "Variable profile",
    plane: "xy",
    width: createLengthQuantity(20, "mm", "#width"),
    height: createLengthQuantity(12, "mm", "12 mm"),
    createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b226"),
    createConstraintId: sequentialIdFactory(
      (value) => sketchConstraintIdSchema.parse(value),
      "b227",
    ),
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

  it("renames by stable ID and atomically refactors variable and feature quantity sources", () => {
    const created = createDocument()
    const width = addVariable(created.snapshot, variableIds.width, "width", "20 mm", 1)
    if (!width.ok) throw new Error(width.diagnostic.message)
    const depth = addVariable(width.snapshot, variableIds.depth, "depth", "#width / 2", 2)
    if (!depth.ok) throw new Error(depth.diagnostic.message)
    const addedFeature = applyDocumentCommand(depth.snapshot, {
      ...envelope("org.vibeshape.feature.add", 3, 3),
      payload: {
        feature: {
          schemaVersion: 0,
          id: featureId,
          type: boxFeatureType.type,
          parameters: {
            width: createLengthQuantity(20, "mm", "#width"),
            depth: createLengthQuantity(10, "mm", "#width / 2"),
            height: createLengthQuantity(5, "mm", "5 mm"),
            centered: false,
          },
          dependencies: [],
          references: [],
          suppressed: false,
          label: "Box 1",
        },
      },
    })
    if (!addedFeature.ok) throw new Error(addedFeature.diagnostic.message)

    const renamed = applyDocumentCommand(addedFeature.snapshot, {
      ...envelope("org.vibeshape.variable.rename", 4, 4),
      payload: { variableId: variableIds.width, name: "span" },
    })

    expect(renamed).toMatchObject({
      ok: true,
      snapshot: {
        revision: 5,
        variables: [
          { id: variableIds.width, name: "span", expression: "20 mm" },
          { id: variableIds.depth, name: "depth", expression: "#span / 2" },
        ],
        features: [
          {
            id: featureId,
            parameters: {
              width: { source: { expression: "#span" } },
              depth: { source: { expression: "#span / 2" } },
              height: { source: { expression: "5 mm" } },
            },
          },
        ],
      },
      event: {
        type: "org.vibeshape.variable.renamed",
        variableId: variableIds.width,
        previousName: "width",
        name: "span",
      },
    })
    if (!renamed.ok) return
    expect(
      replayDocumentEvents([
        created.event,
        width.event,
        depth.event,
        addedFeature.event,
        renamed.event,
      ]),
    ).toEqual({ ok: true, snapshot: renamed.snapshot })
    expect(
      reduceDocumentEvent(addedFeature.snapshot, { ...renamed.event, previousName: "other" }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-event" } })
  })

  it("rejects rename conflicts, missing variables, and no-op names", () => {
    const created = createDocument()
    const width = addVariable(created.snapshot, variableIds.width, "width", "20 mm", 1)
    if (!width.ok) throw new Error(width.diagnostic.message)
    const depth = addVariable(width.snapshot, variableIds.depth, "depth", "10 mm", 2)
    if (!depth.ok) throw new Error(depth.diagnostic.message)

    expect(
      applyDocumentCommand(depth.snapshot, {
        ...envelope("org.vibeshape.variable.rename", 3, 3),
        payload: { variableId: variableIds.width, name: "depth" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "variable-name-conflict" } })
    expect(
      applyDocumentCommand(depth.snapshot, {
        ...envelope("org.vibeshape.variable.rename", 3, 3),
        payload: { variableId: variableIds.width, name: "width" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "command-no-op" } })
    expect(
      applyDocumentCommand(depth.snapshot, {
        ...envelope("org.vibeshape.variable.rename", 3, 3),
        payload: {
          variableId: "0195b5ac-b229-7a2c-8c33-67a36a7f21ac",
          name: "missing",
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "variable-not-found" } })
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

  it("atomically refactors sketch dimensions and protects their referenced variable", () => {
    const created = createDocument()
    const width = addVariable(created.snapshot, variableIds.width, "width", "20 mm", 1)
    if (!width.ok) throw new Error(width.diagnostic.message)
    const sketched = applyDocumentCommand(width.snapshot, {
      ...envelope("org.vibeshape.sketch.add", 2, 2),
      payload: { sketch: variableDrivenSketch() },
    })
    if (!sketched.ok) throw new Error(sketched.diagnostic.message)

    const renamed = applyDocumentCommand(sketched.snapshot, {
      ...envelope("org.vibeshape.variable.rename", 3, 3),
      payload: { variableId: variableIds.width, name: "span" },
    })
    expect(renamed).toMatchObject({
      ok: true,
      snapshot: {
        variables: [{ id: variableIds.width, name: "span" }],
        sketches: [
          {
            constraints: expect.arrayContaining([
              expect.objectContaining({
                type: "horizontal-distance",
                value: expect.objectContaining({
                  source: expect.objectContaining({ expression: "#span" }),
                }),
              }),
            ]),
          },
        ],
      },
    })
    if (!renamed.ok) return
    expect(
      replayDocumentEvents([created.event, width.event, sketched.event, renamed.event]),
    ).toEqual({ ok: true, snapshot: renamed.snapshot })

    expect(
      applyDocumentCommand(sketched.snapshot, {
        ...envelope("org.vibeshape.variable.remove", 3, 3),
        payload: { variableId: variableIds.width },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "variable-in-use",
        message: expect.stringContaining("sketch dimension"),
      },
    })
    expect(
      applyDocumentCommand(sketched.snapshot, {
        ...envelope("org.vibeshape.variable.replace-table", 3, 3),
        payload: { variables: [] },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "variable-in-use",
        message: expect.stringContaining("sketch dimension"),
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
