import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createLengthQuantity, featureRecordSchema } from "@vibeshape/domain"
import {
  filletFeatureType,
  filletFeatureTypeV2,
  filletFeatureTypeV3,
} from "@vibeshape/domain/part-design"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import {
  candidate,
  copy,
  defaultProps,
  geometry,
  option,
  sourceId,
  treatmentId,
} from "./edge-treatment.test-fixtures"
import { edgeTreatmentCandidates, legacyEdgeReference } from "./edge-treatment-candidates"
import { EdgeTreatmentForm, type EdgeTreatmentFormProps } from "./edge-treatment-form"

afterEach(cleanup)
const filletCopy = { ...copy, title: "Fillet", submit: "Apply fillet", distance: "Radius" }
function setup(overrides: Partial<EdgeTreatmentFormProps> = {}) {
  const onSave = vi.fn(async () => ({ ok: true as const }))
  const props: EdgeTreatmentFormProps = {
    ...defaultProps(),
    copy: filletCopy,
    operation: "fillet",
    mode: { kind: "create", createFeatureId: () => treatmentId, featureLabel: "Fillet 1" },
    onSave,
    ...overrides,
  }
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <EdgeTreatmentForm {...props} />
    </I18nProvider>,
  )
  return { onSave }
}
async function pick(label = "Body A · Edge 1") {
  const summary = screen.getByText("Keyboard choices", { selector: "summary" })
  if (!summary.closest("details")?.open) await userEvent.click(summary)
  await userEvent.click(screen.getByRole("button", { name: label }))
}
async function submit() {
  await userEvent.click(screen.getByRole("button", { name: filletCopy.submit }))
}
function saved(onSave: ReturnType<typeof vi.fn>) {
  return featureRecordSchema.parse(onSave.mock.calls.at(-1)?.[1])
}
function savedFillet(type: typeof filletFeatureTypeV2.type, parameters: unknown, references = []) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: treatmentId,
    type,
    label: "Fillet 1",
    parameters,
    dependencies: [sourceId],
    references,
    suppressed: false,
  })
}
/** The persisted per-edge law, asserted by value rather than only by feature type. */
function persistedLaw(start: number, end: number, reverse: boolean) {
  return {
    kind: "edge",
    variableRadius: { startRadius: { value: start }, endRadius: { value: end }, reverse },
  }
}
/** An authored reference whose anonymous signature drifted after an upstream edit. */
function drifted<T extends { signature: { measure: number; centroid: readonly number[] } }>(
  reference: T,
): T {
  const [x = 0, y = 0, z = 0] = reference.signature.centroid
  return {
    ...reference,
    signature: {
      ...reference.signature,
      measure: reference.signature.measure + 0.05,
      centroid: [x + 0.02, y, z],
    },
  }
}
function exactEdge(options = [option()]) {
  const selected = edgeTreatmentCandidates(options, geometry(options), (kind) => kind)[0]
  if (selected?.reference.schemaVersion !== 1) throw new Error("An exact edge is required.")
  return { ...selected.reference, kind: "edge" as const }
}

it("keeps a plain selection on a verified single-result body on the proven V2 route", async () => {
  const { onSave } = setup()
  expect(screen.getByText(/complete tangent chain of each picked edge/)).toBeTruthy()
  await pick()
  await submit()
  expect(saved(onSave)).toMatchObject({
    type: filletFeatureTypeV2.type,
    parameters: { radius: { value: 1 } },
    references: [{ schemaVersion: 0, kind: "edge" }],
  })
})

it("offers a named output body and authors exact body-bound V3 without All edges", async () => {
  const options = [
    option(sourceId, "split.negative", "Lower half"),
    option(sourceId, "split.positive", "Upper half"),
  ]
  const { onSave } = setup({ options, topologyCandidates: geometry(options) })
  expect(screen.getByRole<HTMLInputElement>("radio", { name: copy.allEdges }).disabled).toBe(true)
  await pick("Upper half · Edge 1")
  await submit()
  expect(saved(onSave)).toMatchObject({
    type: filletFeatureTypeV3.type,
    dependencies: [sourceId],
    references: [],
    parameters: {
      targetBody: { featureId: sourceId, outputRole: "split.positive" },
      radius: { value: 1 },
      targets: [{ kind: "edge", edge: { schemaVersion: 1, outputRole: "split.positive" } }],
    },
  })
})

it("routes a picked face to V3 and returns to V2 when the face is removed", async () => {
  const { onSave } = setup()
  await pick()
  await userEvent.click(screen.getByRole("button", { name: "Pick faces in viewport" }))
  await pick("Body A · Face 1")
  await submit()
  expect(saved(onSave)).toMatchObject({
    type: filletFeatureTypeV3.type,
    parameters: { targets: [{ kind: "edge" }, { kind: "face", face: { kind: "face" } }] },
  })
  await userEvent.click(screen.getByRole("button", { name: "Remove Face 1" }))
  await submit()
  expect(saved(onSave).type).toEqual(filletFeatureTypeV2.type)
})

it("authors a variable radius with a doubled default end, reverse and the documented rule", async () => {
  const { onSave } = setup()
  await pick()
  await userEvent.click(screen.getByRole("checkbox", { name: "Variable radius for Edge 1" }))
  expect(screen.getByText(/smallest X coordinate, then Y, then Z/)).toBeTruthy()
  const start = screen.getByRole<HTMLInputElement>("combobox", { name: "Start radius for Edge 1" })
  const end = screen.getByRole<HTMLInputElement>("combobox", { name: "End radius for Edge 1" })
  expect([start.value, end.value]).toEqual(["1 mm", "2 mm"])
  fireEvent.change(end, { target: { value: "3 mm" } })
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Reverse radius direction for Edge 1" }),
  )
  await submit()
  expect(saved(onSave)).toMatchObject({
    type: filletFeatureTypeV3.type,
    references: [],
    parameters: {
      targets: [
        {
          kind: "edge",
          variableRadius: {
            startRadius: { value: 1 },
            endRadius: { value: 3 },
            reverse: true,
          },
        },
      ],
    },
  })
})

it.each([
  ["equal radii", false, "Use different start and end radii"],
  ["closed edge", true, "needs an open edge with two ends"],
] as const)(
  "blocks submission for an invalid variable radius: %s",
  async (_name, closed, message) => {
    const edge = candidate("edge")
    const options = [
      option(sourceId, "result", "Body A", [
        closed ? { ...edge, signature: { ...edge.signature, boundaryCount: 0 } } : edge,
      ]),
    ]
    const { onSave } = setup({ options, topologyCandidates: geometry(options) })
    await pick()
    await userEvent.click(screen.getByRole("checkbox", { name: "Variable radius for Edge 1" }))
    if (!closed) {
      const end = screen.getByRole("combobox", { name: "End radius for Edge 1" })
      await userEvent.clear(end)
      await userEvent.type(end, "1 mm")
    }
    await submit()
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(new RegExp(message))).toBeTruthy()
  },
)

it("keeps a saved V2 fillet on V2 after its variable radius is enabled and disabled again", async () => {
  const options = [option()]
  const reference = legacyEdgeReference(exactEdge(options))
  if (!reference) throw new Error("A legacy fixture reference is required.")
  const feature = savedFillet(filletFeatureTypeV2.type, { radius: createLengthQuantity(2) }, [
    reference,
  ] as never)
  const { onSave } = setup({ options, mode: { kind: "edit", feature } })
  const toggle = screen.getByRole("checkbox", { name: "Variable radius for Edge 1" })
  await userEvent.click(toggle)
  await submit()
  expect(saved(onSave)).toMatchObject({
    type: filletFeatureTypeV3.type,
    references: [],
    parameters: { radius: { value: 2 }, targets: [persistedLaw(2, 4, false)] },
  })
  await userEvent.click(screen.getByRole("checkbox", { name: "Variable radius for Edge 1" }))
  await submit()
  expect(saved(onSave)).toMatchObject({
    type: filletFeatureTypeV2.type,
    parameters: { radius: { value: 2 } },
    references: [reference],
  })
})

it("restores saved V3 variable-radius intent and keeps All edges on V1 for a single-result body", async () => {
  const options = [option()]
  const edge = { ...exactEdge(options), featureId: sourceId }
  const law = {
    startRadius: createLengthQuantity(1, "mm", "1 mm"),
    endRadius: createLengthQuantity(4, "mm", "4 mm"),
    reverse: true,
  }
  const feature = savedFillet(filletFeatureTypeV3.type, {
    targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
    radius: createLengthQuantity(2, "mm", "2 mm"),
    targets: [{ kind: "edge", edge, variableRadius: law }],
  })
  const { onSave } = setup({ options, mode: { kind: "edit", feature } })
  expect(
    screen.getByRole<HTMLInputElement>("combobox", { name: "End radius for Edge 1" }).value,
  ).toBe("4 mm")
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Reverse radius direction for Edge 1" })
      .checked,
  ).toBe(true)
  await submit()
  expect(saved(onSave).parameters).toEqual(feature.parameters)
  await userEvent.click(screen.getByRole("radio", { name: copy.allEdges }))
  await submit()
  expect(saved(onSave)).toMatchObject({ type: filletFeatureType.type, references: [] })
})

it("restores and edits a saved V3 law whose stored edge signature drifted", async () => {
  const options = [option()]
  const edge = drifted({ ...exactEdge(options), featureId: sourceId })
  const feature = savedFillet(filletFeatureTypeV3.type, {
    targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
    radius: createLengthQuantity(2, "mm", "2 mm"),
    targets: [
      {
        kind: "edge",
        edge,
        variableRadius: {
          startRadius: createLengthQuantity(1, "mm", "1 mm"),
          endRadius: createLengthQuantity(4, "mm", "4 mm"),
          reverse: true,
        },
      },
    ],
  })
  const { onSave } = setup({ options, mode: { kind: "edit", feature } })
  const toggle = screen.getByRole<HTMLInputElement>("checkbox", {
    name: "Variable radius for Edge 1",
  })
  expect(toggle.checked).toBe(true)
  fireEvent.change(screen.getByRole("combobox", { name: "End radius for Edge 1" }), {
    target: { value: "5 mm" },
  })
  await submit()
  const parameters = saved(onSave).parameters
  expect(parameters).toMatchObject({ targets: [{ ...persistedLaw(1, 5, true), edge }] })
  expect((parameters as { targets: unknown[] }).targets).toHaveLength(1)
})

it("routes a drifted saved V2 edge to V3 when its variable radius is enabled", async () => {
  const options = [option()]
  const reference = legacyEdgeReference(drifted(exactEdge(options)))
  if (!reference) throw new Error("A legacy fixture reference is required.")
  const feature = savedFillet(filletFeatureTypeV2.type, { radius: createLengthQuantity(2) }, [
    reference,
  ] as never)
  const { onSave } = setup({ options, mode: { kind: "edit", feature } })
  expect(screen.queryByText(copy.missingEdge)).toBeNull()
  await userEvent.click(screen.getByRole("checkbox", { name: "Variable radius for Edge 1" }))
  await submit()
  expect(saved(onSave)).toMatchObject({
    type: filletFeatureTypeV3.type,
    references: [],
    parameters: {
      radius: { value: 2 },
      targets: [{ ...persistedLaw(2, 4, false), edge: { signature: reference.signature } }],
    },
  })
})

it("lists four selected edges as compact rows and expands Variable radius only when enabled", async () => {
  const options = [
    option(
      sourceId,
      "result",
      "Body A",
      [1, 2, 3, 4].map((n) => candidate("edge", n)),
    ),
  ]
  setup({ options, topologyCandidates: geometry(options) })
  for (const n of [1, 2, 3, 4]) await pick(`Body A · Edge ${n}`)
  expect(screen.getByRole("status").textContent).toBe("4 targets selected")
  // Section guidance lives in the help description, not in stacked paragraphs.
  expect(
    screen.getByRole("group", { name: copy.selectedEdges, description: /complete tangent chain/ }),
  ).toBeTruthy()
  expect(screen.getByRole("button", { name: copy.clearEdges })).toBeTruthy()
  const list = screen.getByRole("list")
  const rows = within(list).getAllByRole("listitem")
  expect(rows).toHaveLength(4)
  for (const [index, row] of rows.entries()) {
    const edge = `Edge ${index + 1}`
    expect(within(row).getByRole("checkbox", { name: `Variable radius for ${edge}` })).toBeTruthy()
    expect(within(row).getByRole("button", { name: `Remove ${edge}` })).toBeTruthy()
    expect(row.querySelector("[data-edge-treatment-row-details]")?.childElementCount).toBe(0)
  }
  expect(screen.queryByRole("combobox", { name: /^(Start|End) radius for/ })).toBeNull()

  const third = rows[2]
  if (!third) throw new Error("The third row must be rendered.")
  await userEvent.click(within(third).getByRole("checkbox", { name: "Variable radius for Edge 3" }))
  const expanded = within(list).getAllByRole("listitem")[2]
  if (!expanded) throw new Error("The third row must stay rendered.")
  expect(within(expanded).getByRole("combobox", { name: "Start radius for Edge 3" })).toBeTruthy()
  expect(within(expanded).getByRole("combobox", { name: "End radius for Edge 3" })).toBeTruthy()
  expect(
    within(expanded).getByRole("checkbox", { name: "Reverse radius direction for Edge 3" }),
  ).toBeTruthy()
  expect(screen.getAllByRole("combobox", { name: /^Start radius for/ })).toHaveLength(1)
})

function twoEdgeBody() {
  return [option(sourceId, "result", "Body A", [candidate("edge", 1), candidate("edge", 2)])]
}

it("keeps focus on the toggled row when the first Variable radius switches Fillet to V3", async () => {
  const options = twoEdgeBody()
  setup({ options, topologyCandidates: geometry(options) })
  for (const n of [1, 2]) await pick(`Body A · Edge ${n}`)
  const toggle = screen.getByRole("checkbox", { name: "Variable radius for Edge 2" })
  await userEvent.click(toggle)
  // The V2 legacy reference is promoted to a body-bound V3 target; the row must not remount.
  expect(screen.getByRole("combobox", { name: "Start radius for Edge 2" })).toBeTruthy()
  expect(screen.getByRole("checkbox", { name: "Variable radius for Edge 2" })).toBe(toggle)
  expect(document.activeElement).toBe(toggle)
  expect((toggle as HTMLInputElement).checked).toBe(true)
})

it("shows each Variable radius issue under the row that owns it", async () => {
  const options = twoEdgeBody()
  const { onSave } = setup({ options, topologyCandidates: geometry(options) })
  for (const n of [1, 2]) await pick(`Body A · Edge ${n}`)
  for (const n of [1, 2])
    await userEvent.click(screen.getByRole("checkbox", { name: `Variable radius for Edge ${n}` }))
  const end = screen.getByRole("combobox", { name: "End radius for Edge 2" })
  await userEvent.clear(end)
  await userEvent.type(end, "1 mm")
  await submit()
  expect(onSave).not.toHaveBeenCalled()
  const [first, second] = within(screen.getByRole("list")).getAllByRole("listitem")
  if (!first || !second) throw new Error("Both rows must be rendered.")
  expect(within(first).queryByText(/Use different start and end radii/)).toBeNull()
  const issue = within(second).getByText(/Use different start and end radii/)
  const toggle = within(second).getByRole("checkbox", { name: "Variable radius for Edge 2" })
  expect(toggle.getAttribute("aria-invalid")).toBe("true")
  expect(toggle.getAttribute("aria-describedby")).toBe(issue.id)
  // The group summary is not repeated once a row names the edge.
  expect(screen.getAllByText(/Use different start and end radii/)).toHaveLength(1)

  // A field-level failure is attached to that field of the owning row.
  const start = within(first).getByRole("combobox", { name: "Start radius for Edge 1" })
  await userEvent.clear(start)
  await userEvent.type(start, "nonsense")
  await submit()
  expect(onSave).not.toHaveBeenCalled()
  expect(start.getAttribute("aria-invalid")).toBe("true")
  const startIssue = document.getElementById(`${start.id}-error`)
  expect(startIssue?.textContent).toBeTruthy()
  expect(start.getAttribute("aria-describedby")).toContain(`${start.id}-error`)
  expect(first.contains(startIssue)).toBe(true)
})
