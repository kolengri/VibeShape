import "../../../../tests/unit/support/dom"
import { afterEach, expect, it, mock, spyOn } from "bun:test"
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { DocumentControllerState } from "../document/document-controller"
import {
  candidate,
  documentId,
  geometry,
  option,
  sourceId,
} from "../features/edge-treatment/edge-treatment.test-fixtures"
import type { EdgeTreatmentTargetOption } from "../features/edge-treatment/edge-treatment-options"
import { i18n } from "../i18n"
import { ApplicationNoticesProvider } from "./application-notices"

let options: readonly EdgeTreatmentTargetOption[] = []
let requestedKind: unknown
mock.module("../features/edge-treatment/edge-treatment-options", () => ({
  edgeTreatmentTargetOptions: (...args: unknown[]) => {
    requestedKind = args.at(-1)
    return options
  },
}))
mock.module("./geometry-viewport", () => ({
  viewerMeshes: () => options.flatMap(({ body }) => (body ? [body] : [])),
}))
const { useModelEdgeSelection } = await import("./use-model-edge-selection")
afterEach(cleanup)

function setup() {
  const onToggle = mock()
  const onChange = mock()
  const hidden: readonly string[] = []
  const controller = {
    report: {
      mode: "read-write",
      snapshot: { id: documentId, revision: 3 },
      rebuild: { ok: true, response: { geometry: geometry(options) } },
    },
  } as unknown as DocumentControllerState
  const view = renderHook(
    ({ enabled }) =>
      useModelEdgeSelection({
        controller,
        enabled,
        selected: null,
        hiddenFeatureIds: hidden,
        visibility: undefined,
        onToggle,
        onChange,
      }),
    {
      initialProps: { enabled: true },
      wrapper: ({ children }) => (
        <I18nProvider i18n={i18n} initialLocale="en">
          <ApplicationNoticesProvider>{children}</ApplicationNoticesProvider>
        </I18nProvider>
      ),
    },
  )
  return { ...view, onToggle, onChange }
}

it("offers and selects exact idle curves without approximate catalogue ranking", () => {
  options = [
    option(
      sourceId,
      "result",
      "Body",
      Array.from({ length: 256 }, (_, index) => candidate("edge", index + 1)),
    ),
  ]
  let rankings = 0
  const original = Array.prototype.sort
  const sorted = spyOn(Array.prototype, "sort").mockImplementation(function (
    this: unknown[],
    compare?: (left: unknown, right: unknown) => number,
  ) {
    if (this.length === 256) rankings++
    return original.call(this, compare)
  })
  try {
    const { result, onToggle } = setup()
    const selection = result.current?.referenceSelection
    expect(requestedKind).toBe("edge")
    expect(selection?.candidates).toHaveLength(256)
    expect(rankings).toBe(0)
    const edge = selection?.candidates[0]
    if (!edge) throw new Error("The source edge must be visible.")
    act(() => selection?.onSelect(edge))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(rankings).toBe(0)
  } finally {
    sorted.mockRestore()
  }
})

it("refuses an ambiguous idle pick visibly and clears that feedback when edge mode ends", async () => {
  const first = candidate("edge")
  options = [option(sourceId, "result", "Body", [first, { ...first, candidateId: "coincident" }])]
  const { result, onToggle, rerender } = setup()
  const edge = result.current?.referenceSelection?.candidates[0]
  if (!edge) throw new Error("Ambiguity must be checked on activation, not silently hidden.")
  act(() => result.current?.referenceSelection?.onSelect(edge))
  expect(onToggle).not.toHaveBeenCalled()
  expect((await screen.findByRole("alert")).textContent).toContain("This edge is ambiguous.")
  rerender({ enabled: false })
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  rerender({ enabled: true })
  expect(screen.queryByRole("alert")).toBeNull()
})

it("uses the same exact body-bound owner for ordinary pointer and keyboard selections", () => {
  options = [option(sourceId, "result", "Body")]
  const { result, onToggle, onChange } = setup()
  const pointer = result.current?.edgeSelection
  const candidate = pointer?.candidates[0]
  if (!candidate) throw new Error("The ordinary edge must have an exact polyline.")
  act(() => pointer?.onSelect(candidate))
  const selected = onToggle.mock.calls[0]?.[0]
  expect(selected).toEqual({
    targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
    edges: [
      expect.objectContaining({
        schemaVersion: 1,
        featureId: sourceId,
        outputRole: "result",
        kind: "edge",
      }),
    ],
  })
  const keyboard = result.current?.referenceSelection
  const curve = keyboard?.candidates[0]
  if (!curve) throw new Error("The same edge must remain keyboard selectable.")
  act(() => keyboard?.onSelect(curve))
  expect(onToggle.mock.calls[1]?.[0]).toEqual(selected)
  act(() => pointer?.onSelect({ ...candidate, outputRole: "foreign" }))
  expect(onToggle).toHaveBeenCalledTimes(2)
  act(() => pointer?.onSelect(null))
  expect(onChange).toHaveBeenCalledWith(null)
})

it("refuses ambiguous ordinary pointer picks through the same repair feedback", async () => {
  const first = candidate("edge")
  options = [option(sourceId, "result", "Body", [first, { ...first, candidateId: "duplicate" }])]
  const { result, onToggle } = setup()
  const pointer = result.current?.edgeSelection
  const edge = pointer?.candidates[0]
  if (!edge) throw new Error("The ambiguous edge must remain explicit.")
  act(() => pointer?.onSelect(edge))
  expect(onToggle).not.toHaveBeenCalled()
  expect((await screen.findByRole("alert")).textContent).toContain("This edge is ambiguous.")
})
