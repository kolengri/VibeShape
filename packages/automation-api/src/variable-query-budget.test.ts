import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { describe, expect, it } from "vitest"
import { queryDocumentVariables, variableListViewSchema } from "./queries"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"

function variableSnapshot() {
  const seeds = Array.from({ length: 8 }, (_, index) => `seed_${index}_${"x".repeat(22)}`)
  const dependencyExpression = seeds.map((seed) => `#${seed}`).join("+")
  const variables = seeds.map((name, index) => ({
    schemaVersion: 0 as const,
    id: `0195b5ac-b240-7a2c-8c33-${String(index).padStart(12, "0")}`,
    name,
    expression: "1 mm",
  }))
  for (let index = seeds.length; index < 208; index += 1) {
    variables.push({
      schemaVersion: 0,
      id: `0195b5ac-b240-7a2c-8c33-${String(index).padStart(12, "0")}`,
      name: `variable_${String(index).padStart(3, "0")}${"x".repeat(50)}`,
      expression: dependencyExpression,
    })
  }
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 2,
    name: "Large variable table",
    createdAt: "2026-08-08T12:00:00Z",
    updatedAt: "2026-08-08T12:05:00Z",
    variables,
  })
}

const query = (limit: number) => ({
  kind: "org.vibeshape.variable.list",
  schemaVersion: 1,
  documentId,
  revision: 2,
  cursor: "8",
  limit,
})

describe("variable query serialization budget", () => {
  it("rejects an oversized valid page with a client-actionable diagnostic", () => {
    const result = queryDocumentVariables(variableSnapshot(), query(200))
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "query-result-too-large",
        retryable: true,
        message: "The variable query result is too large; reduce the page limit.",
      },
    })
  })

  it("keeps smaller pages available", () => {
    const result = queryDocumentVariables(variableSnapshot(), query(10))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.diagnostic.message)
    const view = variableListViewSchema.parse(result.view)
    expect(view.data.variables).toHaveLength(10)
    expect(view.nextCursor).toBe("18")
    expect(JSON.stringify(view).length).toBeLessThan(128 * 1024)
    const next = queryDocumentVariables(variableSnapshot(), {
      ...query(10),
      cursor: view.nextCursor,
    })
    if (!next.ok) throw new Error(next.diagnostic.message)
    const nextView = variableListViewSchema.parse(next.view)
    expect(nextView.data.variables[0]?.definition.id).toBe("0195b5ac-b240-7a2c-8c33-000000000018")
    expect(nextView.data.variables[0]?.result).toEqual({
      dimension: "length",
      value: 8,
      unit: "mm",
    })
    expect(nextView.nextCursor).toBe("28")
  })
})
