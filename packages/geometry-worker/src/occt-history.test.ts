import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { describe, expect, it, vi } from "vitest"
import { captureOcctBooleanHistory, captureOcctFilletHistory } from "./occt-history"

function createDeletable() {
  return { delete: vi.fn() }
}

function createHistoryFixture() {
  const currentShapes: Array<ReturnType<typeof createDeletable> & { HashCode: () => number }> = []
  const explorers: Array<ReturnType<typeof createDeletable>> = []
  const lists: Array<ReturnType<typeof createDeletable>> = []
  let hash = 0

  const opencascade = {
    TopAbs_ShapeEnum: {
      TopAbs_EDGE: {},
      TopAbs_FACE: {},
      TopAbs_SHAPE: {},
      TopAbs_SOLID: {},
      TopAbs_VERTEX: {},
    },
    TopExp_Explorer_2: vi.fn(function MockExplorer() {
      hash += 1
      const current = { ...createDeletable(), HashCode: vi.fn(() => hash) }
      const explorer = {
        ...createDeletable(),
        Current: vi.fn(() => current),
        More: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
        Next: vi.fn(),
      }
      currentShapes.push(current)
      explorers.push(explorer)
      return explorer
    }),
  } as unknown as OpenCascadeInstance

  function createList(size: number) {
    const list = { ...createDeletable(), Size: vi.fn(() => size) }
    lists.push(list)
    return list
  }

  const builder = {
    Generated: vi.fn(() => createList(2)),
    IsDeleted: vi.fn(() => false),
    Modified: vi.fn(() => createList(1)),
  }

  return { builder, currentShapes, explorers, lists, opencascade }
}

describe("OCCT operation history capture", () => {
  it("counts boolean relations for every unique source topology and releases wrappers", () => {
    const fixture = createHistoryFixture()
    const sources = [createDeletable(), createDeletable()]

    const history = captureOcctBooleanHistory(
      fixture.opencascade,
      fixture.builder as never,
      sources as never,
    )

    for (const stats of Object.values(history)) {
      expect(stats).toEqual({
        sourceCount: 2,
        modifiedSourceCount: 2,
        modifiedRelationCount: 2,
        generatedSourceCount: 2,
        generatedRelationCount: 4,
        deletedSourceCount: 0,
      })
    }

    expect(fixture.currentShapes).toHaveLength(8)
    expect(fixture.explorers).toHaveLength(8)
    expect(fixture.lists).toHaveLength(16)

    for (const binding of [...fixture.currentShapes, ...fixture.explorers, ...fixture.lists]) {
      expect(binding.delete).toHaveBeenCalledOnce()
    }
  })

  it("queries only generated edge/vertex and modified/deleted face fillet relations", () => {
    const fixture = createHistoryFixture()

    const history = captureOcctFilletHistory(
      fixture.opencascade,
      fixture.builder as never,
      createDeletable() as never,
    )

    expect(history.vertices.generatedRelationCount).toBe(2)
    expect(history.edges.generatedRelationCount).toBe(2)
    expect(history.faces.modifiedRelationCount).toBe(1)
    expect(fixture.builder.Generated).toHaveBeenCalledTimes(2)
    expect(fixture.builder.Modified).toHaveBeenCalledOnce()
    expect(fixture.builder.IsDeleted).toHaveBeenCalledOnce()
  })
})
