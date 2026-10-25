import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, renderHook } from "@testing-library/react"
import { booleanFeatureType } from "@vibeshape/domain"
import { bodyCatalogueFixture } from "./exact-body-catalogue.test-fixtures"
import { useExactSolidBodyOptions } from "./exact-body-options"

afterEach(cleanup)

it("reuses mounted task preparation and invalidates every catalogue source and label input", () => {
  const f = bodyCatalogueFixture(3, 2)
  const geometry = f.rebuild.response.geometry
  let geometryReads = 0
  Object.defineProperty(f.rebuild.response, "geometry", {
    get() {
      geometryReads += 1
      return geometry
    },
  })
  const initial = {
    ...f,
    editing: undefined as string | undefined,
    unnamed: "Unnamed",
    legacy: (name: string) => `${name} · all bodies`,
    enabled: true,
  }
  function useOptions(props: typeof initial) {
    return useExactSolidBodyOptions(
      props.snapshot,
      props.rebuild,
      props.editing,
      props.parts,
      props.unnamed,
      props.legacy,
      props.enabled,
    )
  }
  const { result, rerender } = renderHook(useOptions, { initialProps: initial })
  const first = result.current
  const initialReads = geometryReads
  expect(first).toHaveLength(6)
  expect(initialReads).toBeGreaterThan(0)
  rerender({ ...initial })
  expect(result.current).toBe(first)
  expect(geometryReads).toBe(initialReads)

  const renamed = {
    ...initial,
    parts: f.parts.map((entry) => ({ ...entry, part: { ...entry.part, name: "Renamed" } })),
  }
  rerender(renamed)
  expect(result.current[0]?.label).toBe("Renamed")
  expect(geometryReads).toBeGreaterThan(initialReads)
  const readBeforeEdit = geometryReads
  const editing = { ...renamed, editing: f.snapshot.features[1]?.id }
  rerender(editing)
  expect(result.current).toHaveLength(2)
  expect(geometryReads).toBeGreaterThan(readBeforeEdit)

  const unnamed = {
    ...initial,
    unnamed: "Localized unnamed",
    parts: [],
    snapshot: {
      ...f.snapshot,
      features: f.snapshot.features.map((feature) => ({ ...feature, label: undefined })),
    },
  }
  rerender(unnamed)
  expect(result.current[0]?.label).toBe("Localized unnamed · pattern.instance.0")
  const relabeled = {
    ...unnamed,
    snapshot: {
      ...unnamed.snapshot,
      features: unnamed.snapshot.features.map((feature) => ({
        ...feature,
        label: "Changed feature",
      })),
    },
  }
  rerender(relabeled)
  expect(result.current[0]?.label).toBe("Changed feature · pattern.instance.0")
  const beforeRebuild = result.current
  rerender({
    ...relabeled,
    rebuild: { ...f.rebuild, response: { ...f.rebuild.response, geometry: [] } },
  })
  expect(result.current).toEqual([])
  expect(result.current).not.toBe(beforeRebuild)

  rerender({ ...initial, enabled: false })
  const disabledReads = geometryReads
  expect(result.current).toEqual([])
  rerender({ ...initial, enabled: false })
  expect(geometryReads).toBe(disabledReads)
  rerender(initial)
  expect(result.current).toHaveLength(6)

  const other = renderHook(useOptions, { initialProps: initial })
  expect(other.result.current).toEqual(result.current)
  expect(other.result.current).not.toBe(result.current)
})

it("refreshes localized legacy labels independently of unchanged geometry", () => {
  const f = bodyCatalogueFixture(2, 2)
  const source = f.snapshot.features[0]
  const edited = f.snapshot.features[1]
  if (!source || !edited) throw new Error("Expected legacy edit fixture")
  const snapshot = {
    ...f.snapshot,
    features: [source, { ...edited, type: booleanFeatureType.type, dependencies: [source.id] }],
  }
  const initial = { label: (name: string) => `${name} · all bodies` }
  const { result, rerender } = renderHook(
    ({ label }) =>
      useExactSolidBodyOptions(snapshot, f.rebuild, edited.id, f.parts, "Unnamed", label),
    { initialProps: initial },
  )
  expect(result.current[0]?.label).toBe("Producer 1 · all bodies")
  rerender({ label: (name) => `${name} · localized all bodies` })
  expect(result.current[0]?.label).toBe("Producer 1 · localized all bodies")
})
