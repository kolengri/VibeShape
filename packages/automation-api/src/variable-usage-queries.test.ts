import { describe, expect, it } from "bun:test"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { createQueryDispatcher, documentCoreQueryHandlers } from "./queries"
import {
  modelVariableUsageViewSchema,
  queryVariableUsage,
  variableUsageResultContextMatches,
} from "./variable-usage-queries"

const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
const variable = (index: number, name: string, expression: string) => ({
  schemaVersion: 0,
  id: id(index),
  name,
  expression,
})
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: id(10),
  label: "#root is a label",
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(2, "mm", "#root + #other"),
    depths: [
      { amount: createLengthQuantity(2, "mm", "#diamond") },
      createLengthQuantity(2, "mm", "#root"),
    ],
    text: "#root",
    expression: "#root",
    unrelated: createLengthQuantity(2, "mm", "#root_extra"),
  },
  suppressed: true,
  dependencies: [],
  references: [],
})
const sketch = sketchRecordSchema.parse({
  schemaVersion: 0,
  id: id(11),
  label: "Profile",
  plane: "xy",
  entities: [
    { schemaVersion: 0, id: id(12), type: "point", construction: false, x: 0, y: 0 },
    { schemaVersion: 0, id: id(13), type: "point", construction: false, x: 2, y: 0 },
  ],
  constraints: [
    {
      schemaVersion: 0,
      id: id(14),
      type: "distance",
      firstPointId: id(12),
      secondPointId: id(13),
      value: createLengthQuantity(2, "mm", "#branch"),
    },
  ],
})
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: id(100),
  revision: 7,
  name: "Variable usage",
  variables: [
    variable(1, "root", "2 mm"),
    variable(2, "branch", "#root * 2"),
    variable(3, "other", "#root * 3"),
    variable(4, "diamond", "#branch + #other"),
    variable(5, "root_extra", "1 mm"),
  ],
  features: [feature],
  sketches: [sketch],
  createdAt: "2026-10-27T12:00:00Z",
  updatedAt: "2026-10-27T12:00:00Z",
})
const query = (overrides: Record<string, unknown> = {}) => ({
  kind: "org.vibeshape.cad.variable-usage",
  schemaVersion: 1,
  documentId: snapshot.id,
  revision: 7,
  variableId: id(1),
  ...overrides,
})
function view(overrides: Record<string, unknown> = {}) {
  const result = queryVariableUsage(snapshot, query(overrides))
  if (!result.ok) throw new Error(result.diagnostic.message)
  expect(modelVariableUsageViewSchema.safeParse(result.view).success).toBe(true)
  return result.view
}

describe("saved variable usage", () => {
  it("reports each direct consumer location, including suppressed feature quantities, without string or name-prefix false positives", () => {
    expect(view()).toMatchObject({
      variableId: id(1),
      variableName: "root",
      data: {
        coverage: "complete",
        total: 4,
        diagnosticTotal: 0,
        items: [
          {
            kind: "variable",
            variableId: id(2),
            name: "branch",
            parameterPath: ["expression"],
            expression: "#root * 2",
            distance: 1,
          },
          { kind: "variable", variableId: id(3), name: "other", distance: 1 },
          {
            kind: "feature",
            entity: { kind: "feature", id: feature.id },
            type: boxFeatureType.type.typeId,
            suppressed: true,
            parameterPath: ["parameters", "depths", 1],
            expression: "#root",
            distance: 1,
          },
          { kind: "feature", parameterPath: ["parameters", "width"], distance: 1 },
        ],
      },
    })
  })

  it("follows dependent variables with shortest-hop distances and retains every sketch and feature location", () => {
    const items = view({ transitive: true }).data.items
    expect(items).toHaveLength(7)
    expect(items.find((item) => item.kind === "variable" && item.name === "diamond")).toMatchObject(
      { distance: 2 },
    )
    expect(items.filter((item) => item.kind === "feature")).toMatchObject([
      { parameterPath: ["parameters", "depths", 1], distance: 1 },
      { parameterPath: ["parameters", "depths", 0, "amount"], distance: 3 },
      { parameterPath: ["parameters", "width"], distance: 1 },
    ])
    expect(items.at(-1)).toMatchObject({
      kind: "sketch-constraint",
      entity: { kind: "sketch", id: sketch.id },
      label: "Profile",
      constraintId: id(14),
      constraintType: "distance",
      parameterPath: ["constraints", 0, "value"],
      expression: "#branch",
      distance: 2,
    })
  })

  it("paginates deterministically, binds stable identity and rejects stale, missing and malformed queries", () => {
    const first = view({ transitive: true, limit: 3 })
    const second = view({ transitive: true, limit: 3, cursor: first.nextCursor })
    const third = view({ transitive: true, limit: 3, cursor: second.nextCursor })
    expect([...first.data.items, ...second.data.items, ...third.data.items]).toEqual(
      view({ transitive: true }).data.items,
    )
    expect(third.nextCursor).toBeNull()
    expect(view({ cursor: "4" }).data.items).toEqual([])
    for (const [change, code] of [
      [{ variableId: id(99) }, "variable-not-found"],
      [{ revision: 6 }, "stale-query-revision"],
      [{ documentId: id(99) }, "document-id-mismatch"],
      [{ cursor: "5" }, "invalid-query"],
      [{ cursor: "-1" }, "invalid-query"],
      [{ limit: 101 }, "invalid-query"],
      [{ variableName: "root" }, "invalid-query"],
    ] as const)
      expect(queryVariableUsage(snapshot, query(change))).toMatchObject({
        ok: false,
        diagnostic: { code },
      })
    expect(queryVariableUsage(null, query())).toMatchObject({
      ok: false,
      diagnostic: { code: "document-not-found" },
    })
    const renamed = {
      ...snapshot,
      variables: snapshot.variables.map((definition) =>
        definition.id === id(1) ? { ...definition, name: "renamed" } : definition,
      ),
    }
    expect(queryVariableUsage(renamed, query())).toMatchObject({
      ok: true,
      view: { variableName: "renamed", data: { total: 0 } },
    })
  })

  it("discloses lexical failures and bounds diagnostics and serialized output", () => {
    const broken = {
      ...feature,
      parameters: Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [
          `value${index}`,
          createLengthQuantity(1, "mm", "#root@"),
        ]),
      ),
    }
    const result = queryVariableUsage({ ...snapshot, features: [broken] }, query())
    expect(result).toMatchObject({
      ok: true,
      view: { data: { coverage: "partial", diagnosticTotal: 30 } },
    })
    if (!result.ok) throw new Error(result.diagnostic.message)
    expect(result.view.data.diagnostics).toHaveLength(20)
    expect(result.view.data.diagnostics[0]).toMatchObject({
      kind: "feature",
      parameterPath: ["parameters", "value29"],
      expression: "#root@",
      code: "invalid-expression-syntax",
    })
    const huge = {
      ...feature,
      parameters: { ["x".repeat(128 * 1024)]: createLengthQuantity(1, "mm", "#root") },
    }
    expect(queryVariableUsage({ ...snapshot, features: [huge] }, query())).toMatchObject({
      ok: false,
      diagnostic: { code: "query-result-too-large" },
    })
  })

  it("bounds cyclic saved references and never returns the target variable itself", () => {
    const cyclic = {
      ...snapshot,
      variables: snapshot.variables.map((definition) =>
        definition.id === id(1) ? { ...definition, expression: "#diamond" } : definition,
      ),
    }
    const result = queryVariableUsage(cyclic, query({ transitive: true }))
    expect(result).toMatchObject({ ok: true, view: { data: { total: 7 } } })
  })

  it("correlates response identity, traversal and paging in both transports", () => {
    const operation = {
      tool: "model_variable_usage",
      arguments: { revision: 7, variableId: id(1), transitive: true },
    }
    const valid = view({ transitive: true })
    const matches = (value: unknown, documentId: string = snapshot.id) =>
      variableUsageResultContextMatches(operation, { ok: true, value }, documentId)
    expect(matches(valid)).toBe(true)
    for (const change of [
      { revision: 6 },
      { documentId: id(99) },
      { variableId: id(2) },
      { transitive: false },
      { nextCursor: "7" },
      { data: { ...valid.data, items: [] } },
      { data: { ...valid.data, items: [valid.data.items[0], valid.data.items[0]] } },
    ])
      expect(matches({ ...valid, ...change })).toBe(false)
    expect(matches(valid, id(99))).toBe(false)
    expect(variableUsageResultContextMatches(operation, { ok: false })).toBe(true)
    expect(
      variableUsageResultContextMatches({ tool: "model_info", arguments: {} }, { ok: true }),
    ).toBeNull()
    expect(
      variableUsageResultContextMatches(
        { ...operation, arguments: { ...operation.arguments, limit: 1 } },
        { ok: true, value: valid },
      ),
    ).toBe(false)
  })

  it("uses the registered semantic query dispatcher", () => {
    const registry = createModuleRegistry([documentCoreModule])
    if (!registry.ok) throw new Error(registry.diagnostic.message)
    const dispatcher = createQueryDispatcher(registry.registry, documentCoreQueryHandlers)
    if (!dispatcher.ok) throw new Error(dispatcher.diagnostic.message)
    expect(dispatcher.dispatcher.dispatch(snapshot, query())).toEqual(
      queryVariableUsage(snapshot, query()),
    )
  })
})
