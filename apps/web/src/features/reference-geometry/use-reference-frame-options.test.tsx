import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, renderHook } from "@testing-library/react"
import { extrusionBodyFixture } from "../extrusion/extrusion-body-test-fixtures"
import { useReferenceFrameOptions } from "./use-reference-frame-options"

afterEach(cleanup)

it("retains immutable support options and invalidates them for changed geometry, revision and edit scope", () => {
  const { snapshot, rebuild } = extrusionBodyFixture(undefined, false, "PLANE")
  if (!rebuild.ok) throw new Error("The fixture requires exact geometry.")
  const { result, rerender } = renderHook(
    ({
      source,
      geometry,
      excluded,
    }: {
      source: typeof snapshot
      geometry: typeof rebuild
      excluded: string | undefined
    }) => useReferenceFrameOptions(source, geometry, excluded),
    {
      initialProps: {
        source: snapshot,
        geometry: rebuild,
        excluded: undefined as string | undefined,
      },
    },
  )
  const original = result.current
  expect(original.planes).toHaveLength(1)
  rerender({ source: snapshot, geometry: rebuild, excluded: undefined })
  expect(result.current).toBe(original)
  const response = rebuild.response
  const replacement = {
    ...rebuild,
    response: {
      ...response,
      geometry: response.geometry.map((record) => ({
        ...record,
        geometry: {
          ...record.geometry,
          bodies: record.geometry.bodies?.map((body) => ({
            ...body,
            topologyCandidates: body.topologyCandidates.map((candidate) => ({
              ...candidate,
              semanticRole: "replacement.face",
            })),
          })),
        },
      })),
    },
  }
  rerender({ source: snapshot, geometry: replacement, excluded: undefined })
  expect(result.current).not.toBe(original)
  const support = result.current.planes[0]?.support
  expect(support).toMatchObject({
    kind: "planar-face",
    reference: { semanticRole: "replacement.face" },
  })
  expect(original.planes[0]?.support).not.toMatchObject({
    reference: { semanticRole: "replacement.face" },
  })
  rerender({
    source: { ...snapshot, revision: snapshot.revision + 1 },
    geometry: rebuild,
    excluded: undefined,
  })
  expect(result.current.planes).toHaveLength(0)
  const featureId = snapshot.features[0]?.id
  if (!featureId) throw new Error("The fixture requires a source feature.")
  rerender({ source: snapshot, geometry: rebuild, excluded: featureId })
  expect(result.current.planes).toHaveLength(0)
  rerender({ source: snapshot, geometry: rebuild, excluded: undefined })
  expect(result.current.planes).toHaveLength(1)
})
