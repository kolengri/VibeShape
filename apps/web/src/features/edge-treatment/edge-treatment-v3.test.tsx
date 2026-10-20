import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createLengthQuantity, featureRecordSchema } from "@vibeshape/domain"
import { chamferFeatureTypeV2, chamferFeatureTypeV3 } from "@vibeshape/domain/part-design"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import {
  candidate,
  copy,
  defaultProps,
  geometry,
  option,
  otherId,
  sourceId,
  treatmentId,
} from "./edge-treatment.test-fixtures"
import { edgeTreatmentCreateTool } from "./edge-treatment-activation"
import { edgeTreatmentCandidates, legacyEdgeReference } from "./edge-treatment-candidates"
import { EdgeTreatmentForm, type EdgeTreatmentFormProps } from "./edge-treatment-form"

afterEach(cleanup)
function setup(overrides: Partial<EdgeTreatmentFormProps> = {}) {
  const onSave = vi.fn(async () => ({ ok: true as const }))
  const props = { ...defaultProps(), onSave, ...overrides }
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <EdgeTreatmentForm {...props} />
    </I18nProvider>,
  )
  return { ...view, props, onSave }
}
async function pick(label = "Body A · Edge 1") {
  const summary = screen.getByText("Keyboard choices", { selector: "summary" })
  if (!summary.closest("details")?.open) await userEvent.click(summary)
  await userEvent.click(screen.getByRole("button", { name: label }))
}
async function mode(value: "two-distances" | "distance-angle" | "equal-distance") {
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Chamfer mode" }), value)
}
async function chooseSide() {
  await userEvent.click(screen.getByRole("button", { name: "Pick side face for Edge 1" }))
  await pick("Body A · Face 1")
}
function saved(onSave: ReturnType<typeof vi.fn>) {
  return featureRecordSchema.parse(onSave.mock.calls.at(-1)?.[1])
}

it("keeps an ordinary circular rim on legacy V2 with its explicit edge reference", async () => {
  const options = [option(sourceId, "result", "Body A", [candidate("edge", 1, true)])]
  const { onSave } = setup({ options, topologyCandidates: geometry(options) })
  await pick()
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave)).toMatchObject({
    type: chamferFeatureTypeV2.type,
    dependencies: [sourceId],
    references: [{ schemaVersion: 0, kind: "edge", signature: { geometryClass: "CIRCLE" } }],
  })
  expect(saved(onSave).parameters).not.toHaveProperty("mode")
})

it("promotes an edited V2 edge set into typed V3 targets only after advanced controls are requested", async () => {
  const options = [option()]
  const selected = edgeTreatmentCandidates(options, geometry(options), (kind) => kind)[0]
  const reference = selected ? legacyEdgeReference(selected.reference) : null
  if (!reference) throw new Error("Missing legacy fixture reference.")
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: treatmentId,
    type: chamferFeatureTypeV2.type,
    label: "Chamfer 1",
    parameters: { distance: createLengthQuantity(1) },
    dependencies: [sourceId],
    references: [reference],
    suppressed: false,
  })
  const { onSave } = setup({
    options,
    topologyCandidates: geometry(options),
    mode: { kind: "edit", feature },
  })
  expect(screen.getByRole("button", { name: "Remove Edge 1" })).toBeTruthy()
  await mode("two-distances")
  expect(screen.getByRole("button", { name: "Remove Edge 1" })).toBeTruthy()
  await chooseSide()
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave)).toMatchObject({
    id: treatmentId,
    type: chamferFeatureTypeV3.type,
    references: [],
    parameters: { targets: [{ kind: "edge", edge: { schemaVersion: 1, outputRole: "result" } }] },
  })
})

it("uses V3 for a result slot when its producer also has other exact bodies", async () => {
  const options = [
    { ...option(), legacy: false },
    option(sourceId, "pattern.instance.1", "Second output"),
  ]
  const { onSave } = setup({ options, topologyCandidates: geometry(options) })
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "All edges" }).disabled).toBe(true)
  await pick()
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave)).toMatchObject({
    type: chamferFeatureTypeV3.type,
    references: [],
    parameters: { targetBody: { featureId: sourceId, outputRole: "result" } },
  })
})

it("requires an explicit side face, then submits actual two-distance V3 intent and edge direction", async () => {
  const { onSave } = setup()
  await pick()
  await mode("two-distances")
  expect(screen.queryByRole("combobox", { name: "Angle" })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(onSave).not.toHaveBeenCalled()
  expect(
    screen.getAllByText("Pick an explicit side face for each directional edge.").length,
  ).toBeGreaterThan(0)
  await chooseSide()
  fireEvent.change(screen.getByRole("combobox", { name: "Distance" }), {
    target: { value: "2 mm" },
  })
  fireEvent.change(screen.getByRole("combobox", { name: "Second distance" }), {
    target: { value: "3 mm" },
  })
  await userEvent.click(screen.getByRole("checkbox", { name: "Flip direction" }))
  await userEvent.click(screen.getByRole("checkbox", { name: "Reverse Edge 1" }))
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave)).toMatchObject({
    type: chamferFeatureTypeV3.type,
    references: [],
    dependencies: [sourceId],
    parameters: {
      targetBody: { featureId: sourceId, outputRole: "result" },
      mode: "two-distances",
      distance: { value: 2 },
      secondDistance: { value: 3 },
      flip: true,
      measurement: "offset",
      tangentPropagation: false,
      targets: [
        {
          kind: "edge",
          edge: { schemaVersion: 1, outputRole: "result" },
          sideFace: { schemaVersion: 1, kind: "face", outputRole: "result" },
        },
      ],
      directionOverrides: [{ schemaVersion: 1, kind: "edge", outputRole: "result" }],
    },
  })
  expect(saved(onSave).parameters).not.toHaveProperty("angle")
  expect(JSON.stringify(saved(onSave))).not.toContain("candidateId")
  expect(JSON.stringify(saved(onSave))).not.toContain("meshFaceId")
})

it("stores a bounded angle in radians only in distance-angle mode and clears direction in equal mode", async () => {
  const { onSave } = setup()
  await pick()
  await mode("distance-angle")
  await chooseSide()
  expect(screen.queryByRole("combobox", { name: "Second distance" })).toBeNull()
  fireEvent.change(screen.getByRole("combobox", { name: "Angle" }), { target: { value: "90 deg" } })
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(onSave).not.toHaveBeenCalled()
  expect(screen.getByText("Use an angle greater than 0 and less than 90 degrees.")).toBeTruthy()
  fireEvent.change(screen.getByRole("combobox", { name: "Angle" }), { target: { value: "30 deg" } })
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Measurement" }), "tangent")
  await userEvent.click(screen.getByRole("checkbox", { name: "Propagate along tangent edges" }))
  await userEvent.click(screen.getByRole("checkbox", { name: "Reverse Edge 1" }))
  await userEvent.click(screen.getByRole("checkbox", { name: "Flip direction" }))
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave).parameters).toMatchObject({
    mode: "distance-angle",
    angle: { dimension: "angle", value: Math.PI / 6 },
    measurement: "tangent",
    tangentPropagation: true,
  })
  expect(saved(onSave).parameters).not.toHaveProperty("secondDistance")
  await mode("equal-distance")
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Flip direction" }).disabled).toBe(
    true,
  )
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Flip direction" }).checked).toBe(
    false,
  )
  expect(screen.queryByRole("checkbox", { name: "Reverse Edge 1" })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave).parameters).toMatchObject({
    mode: "equal-distance",
    flip: false,
    directionOverrides: [],
  })
  expect(saved(onSave).parameters).not.toHaveProperty("angle")
})

it("persists an exact face target on the named second output with one dependency and no generic references", async () => {
  const options = [
    option(sourceId, "pattern.instance.0", "First output"),
    option(sourceId, "pattern.instance.1", "Second output"),
  ]
  const { onSave } = setup({ options, topologyCandidates: geometry(options) })
  await userEvent.click(screen.getByRole("button", { name: "Pick faces in viewport" }))
  await pick("Second output · Face 1")
  expect(screen.queryByRole("combobox", { name: copy.target })).toBeNull()
  expect(screen.getByText(options[1]?.label ?? "", { exact: true })).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave)).toMatchObject({
    type: chamferFeatureTypeV3.type,
    dependencies: [sourceId],
    references: [],
    parameters: {
      targetBody: { featureId: sourceId, outputRole: "pattern.instance.1" },
      targets: [
        {
          kind: "face",
          face: { schemaVersion: 1, kind: "face", outputRole: "pattern.instance.1" },
        },
      ],
    },
  })
})

it("switches bodies from a new graphical edge request and clears incompatible side and override intent", async () => {
  const options = [option(), option(otherId, "result", "Body B")]
  const props = { ...defaultProps(options), onSave: vi.fn(async () => ({ ok: true as const })) }
  const { rerender } = setup(props)
  await pick()
  await mode("two-distances")
  await chooseSide()
  await userEvent.click(screen.getByRole("checkbox", { name: "Reverse Edge 1" }))
  const other = edgeTreatmentCandidates(
    options,
    geometry(options),
    (kind, ordinal) => `${kind} ${ordinal}`,
  ).find((entry) => entry.optionId === otherId && entry.reference.kind === "edge")
  if (!other) throw new Error("Missing second body edge.")
  rerender(
    <I18nProvider i18n={i18n} initialLocale="en">
      <EdgeTreatmentForm
        {...props}
        pickingRequest={{
          sequence: 7,
          featureId: treatmentId,
          optionId: other.optionId,
          reference: other.reference,
          pick: { kind: "edges" },
        }}
      />
    </I18nProvider>,
  )
  await waitFor(() => expect(screen.getByText("Body B", { exact: true })).toBeTruthy())
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Reverse Edge 1" }).checked).toBe(
    false,
  )
  expect(screen.getByRole("button", { name: "Pick side face for Edge 1" }).textContent).toContain(
    "Pick an explicit side face",
  )
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(props.onSave).not.toHaveBeenCalled()
})

it("reports unsupported advanced curved supports while keeping the normal rim path available", async () => {
  const options = [option(sourceId, "result", "Body A", [candidate("edge", 1, true)])]
  const { onSave } = setup({ options, topologyCandidates: geometry(options) })
  await pick()
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Measurement" }), "tangent")
  expect(screen.getByText(/Advanced Chamfer supports proven planar face pairs only/)).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(onSave).not.toHaveBeenCalled()
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Measurement" }), "offset")
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave).type).toEqual(chamferFeatureTypeV2.type)
})

it("exposes bounded keyboard fallback for missing display curves and cancels active picking with focus restoration", async () => {
  const options = [option()]
  const onCancel = vi.fn(),
    onPickingContextChange = vi.fn()
  const { onSave } = setup({
    options,
    topologyCandidates: geometry(options, false),
    onCancel,
    onPickingContextChange,
  })
  expect(screen.getByText(/1 edge has no viewport display curve/)).toBeTruthy()
  const field = screen.getByRole("button", { name: "Pick edges in viewport" })
  expect(document.activeElement).toBe(field)
  await userEvent.click(field)
  await userEvent.click(field)
  await userEvent.keyboard("{Escape}")
  expect(field.getAttribute("aria-pressed")).toBe("false")
  expect(document.activeElement).toBe(field)
  expect(onCancel).not.toHaveBeenCalled()
  expect(onPickingContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ pick: null }))
  await pick()
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave).type).toEqual(chamferFeatureTypeV2.type)
})

it("refuses an ambiguous catalogue candidate visibly and never fabricates its reference", async () => {
  const first = candidate("edge")
  const options = [
    option(sourceId, "result", "Body A", [first, { ...first, candidateId: "edge-copy" }]),
  ]
  const { onSave } = setup({ options, topologyCandidates: geometry(options) })
  await userEvent.click(screen.getByText("Keyboard choices", { selector: "summary" }))
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Body A · Edge 1" }).disabled).toBe(
    true,
  )
  expect(screen.getAllByText(copy.ambiguousEdge).length).toBeGreaterThan(0)
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(onSave).not.toHaveBeenCalled()
})

it("bounds keyboard choices to 32 rows per page while retaining all exact candidates", async () => {
  const options = [
    option(
      sourceId,
      "result",
      "Body A",
      Array.from({ length: 65 }, (_, index) => candidate("edge", index + 1)),
    ),
  ]
  const { onSave } = setup({ options, topologyCandidates: geometry(options, false) })
  await userEvent.click(screen.getByText("Keyboard choices", { selector: "summary" }))
  expect(screen.getAllByRole("button", { name: /^Body A · Edge / })).toHaveLength(32)
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(screen.getByText("Page 2 of 3")).toBeTruthy()
  expect(screen.getAllByRole("button", { name: /^Body A · Edge / })).toHaveLength(32)
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(screen.getAllByRole("button", { name: /^Body A · Edge / })).toHaveLength(1)
  await pick("Body A · Edge 65")
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave).references[0]?.signature.centroid).toEqual([650, 0, 0])
})

it("seeds exact idle edge preselection through activation and rejects a foreign output role", async () => {
  const options = [
    option(sourceId, "pattern.instance.0", "First output"),
    option(sourceId, "pattern.instance.1", "Second output"),
  ]
  const selected = edgeTreatmentCandidates(options, geometry(options), (kind) => kind).find(
    (entry) => entry.optionId === options[1]?.id && entry.reference.kind === "edge",
  )
  const body = options[1]?.body
  if (selected?.reference.schemaVersion !== 1 || !body)
    throw new Error("Missing exact preselection fixture.")
  const tool = edgeTreatmentCreateTool("create-chamfer", null, [], {
    targetBody: body,
    edges: [selected.reference],
  })
  const { onSave } = setup({
    options,
    topologyCandidates: geometry(options),
    mode: {
      kind: "create",
      createFeatureId: () => treatmentId,
      featureLabel: "Chamfer",
      targetFeatureId: tool.targetFeatureId,
      edgeSelection: tool.edgeSelection,
    },
  })
  expect(screen.queryByRole("combobox", { name: copy.target })).toBeNull()
  expect(screen.getByText(options[1]?.label ?? "", { exact: true })).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  expect(saved(onSave).parameters).toMatchObject({
    targetBody: body,
    targets: [{ edge: { outputRole: "pattern.instance.1" } }],
  })
  expect(
    edgeTreatmentCreateTool("create-chamfer", null, [{ id: sourceId }], {
      targetBody: body,
      edges: [{ ...selected.reference, outputRole: "pattern.instance.0" }],
    }).edgeSelection,
  ).toBeUndefined()
})
