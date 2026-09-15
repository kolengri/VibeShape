// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  featureIdSchema,
  featureRecordSchema,
  holeFeatureType,
  holeFeatureTypeV2,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
  topoRefSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { HoleForm, type HoleFormCopy } from "./hole-form"

const sketch = sketchRecordSchema.parse({
  schemaVersion: 0,
  id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4801"),
  label: "Sketch 1",
  plane: "xy",
  entities: [
    {
      schemaVersion: 0,
      id: sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4802"),
      type: "point",
      x: 1,
      y: 2,
      construction: false,
    },
  ],
  constraints: [],
})
const target = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4803")
const holeFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4804")
const validPointId = sketch.entities[0]?.id
if (!validPointId) throw new Error("Fixture point is missing.")
const missingPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4810")
const supportReference = topoRefSchema.parse({
  schemaVersion: 0,
  featureId: target,
  kind: "face",
  semanticRole: "extrusion.cap.end",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 400,
    centroid: [0, 0, 10],
    bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
    direction: [0, 0, 1],
    directionMode: "oriented",
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE"],
  },
})
const copy: HoleFormCopy = {
  title: "Hole",
  description: "Create holes",
  cancel: "Cancel",
  sketch: "Sketch",
  sketchDescription: "Choose a sketch",
  target: "Target",
  targetDescription: "Choose a target",
  points: "Points",
  pointsDescription: "Choose points",
  pointLabel: (ordinal) => `Point ${ordinal}`,
  missingPoint: "Select a valid point.",
  missingSketch: "Select a sketch.",
  missingTarget: "Select a target.",
  missingTargetRole: "This body output is unavailable.",
  diameter: "Diameter",
  depth: "Depth",
  expressionDescription: "Length",
  direction: "Direction",
  forward: "Forward",
  reverse: "Reverse",
  extent: "Extent",
  blind: "Blind",
  throughAll: "Through all",
  invalidExpression: "Invalid expression",
  invalidDimension: "Invalid dimension",
  invalidRange: "Invalid range",
  validationSummary: "Fix errors",
  saveFailed: "Save failed",
  staleRevision: "Stale revision",
  incompatibleTarget: "Choose the whole result for a sketch on this body.",
  submit: "Create hole",
  removePoint: "Remove point",
  noPoints: "No points",
}

afterEach(cleanup)

function renderForm(overrides: Partial<React.ComponentProps<typeof HoleForm>> = {}) {
  const onSave = overrides.onSave ?? vi.fn(async () => ({ ok: true as const }))
  const props: React.ComponentProps<typeof HoleForm> = {
    baseRevision: 1,
    copy,
    mode: { kind: "create", createFeatureId: () => holeFeatureId, featureLabel: "Hole 1" },
    sketches: [sketch],
    options: [{ featureId: target, label: "Body" }],
    variables: [],
    onCancel: vi.fn(),
    onSave,
    onSaved: vi.fn(),
    previewStatus: "ready",
    ...overrides,
  }
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <HoleForm {...props} />
    </I18nProvider>,
  )
  return { onSave, ...view }
}

async function fillValidForm() {
  const user = userEvent.setup()
  await user.click(screen.getByRole("checkbox", { name: /Point 1/ }))
  const diameter = screen.getByRole("combobox", { name: copy.diameter })
  const depth = screen.getByRole("combobox", { name: copy.depth })
  await user.clear(diameter)
  await user.type(diameter, "5 mm")
  await user.clear(depth)
  await user.type(depth, "10 mm")
  return user
}

describe("HoleForm", () => {
  function editFeature(
    parameters: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) {
    const featureParameters = {
      sketchId: sketch.id,
      pointIds: [validPointId],
      diameter: createLengthQuantity(5),
      direction: "forward",
      extent: "blind",
      depth: createLengthQuantity(10),
      ...parameters,
    }
    const { depth, ...throughAllParameters } = featureParameters
    return featureRecordSchema.parse({
      schemaVersion: 0,
      id: holeFeatureId,
      type: holeFeatureType.type,
      parameters:
        featureParameters.extent === "through-all" ? throughAllParameters : featureParameters,
      dependencies: [target],
      references: [],
      suppressed: false,
      label: "Hole 1",
      ...overrides,
    })
  }

  it("keeps missing point selection visible and blocks save", async () => {
    const { onSave } = renderForm()
    const user = userEvent.setup()
    await user.type(screen.getByRole("combobox", { name: copy.diameter }), "5 mm")
    await user.type(screen.getByRole("combobox", { name: copy.depth }), "10 mm")
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(screen.getByText(copy.validationSummary)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it("does not save while the exact preview is pending", async () => {
    const { onSave } = renderForm({ previewStatus: "loading" })
    const user = await fillValidForm()
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it("authors a named body target as Hole schema v2", async () => {
    const { onSave } = renderForm({
      options: [
        { featureId: target, outputRole: "pattern.instance.1", label: "Body · pattern.instance.1" },
      ],
    })
    await fillValidForm()
    await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: holeFeatureTypeV2.type,
        parameters: expect.objectContaining({
          targetBody: { schemaVersion: 0, featureId: target, outputRole: "pattern.instance.1" },
        }),
      }),
    )
  })

  it("preserves a named target while editing Hole v2", async () => {
    const feature = featureRecordSchema.parse({
      ...editFeature({}),
      type: holeFeatureTypeV2.type,
      parameters: {
        ...editFeature({}).parameters,
        targetBody: { schemaVersion: 0, featureId: target, outputRole: "pattern.instance.1" },
      },
    })
    const { onSave } = renderForm({
      mode: { kind: "edit", feature },
      options: [
        { featureId: target, outputRole: "pattern.instance.1", label: "Body · pattern.instance.1" },
      ],
    })
    await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: holeFeatureTypeV2.type,
        parameters: expect.objectContaining({
          targetBody: { schemaVersion: 0, featureId: target, outputRole: "pattern.instance.1" },
        }),
      }),
    )
  })

  it("keeps a legacy unnamed target at Hole schema v1 while editing", async () => {
    const { onSave } = renderForm({
      mode: { kind: "edit", feature: editFeature({}) },
      options: [{ featureId: target, label: "Body" }],
    })
    await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: holeFeatureType.type,
        parameters: expect.not.objectContaining({ targetBody: expect.anything() }),
      }),
    )
  })

  it("allows a v2 edit to switch explicitly to the legacy whole-result target", async () => {
    const feature = featureRecordSchema.parse({
      ...editFeature({}),
      type: holeFeatureTypeV2.type,
      parameters: {
        ...editFeature({}).parameters,
        targetBody: { schemaVersion: 0, featureId: target, outputRole: "pattern.instance.1" },
      },
    })
    const { onSave } = renderForm({
      mode: { kind: "edit", feature },
      options: [
        { featureId: target, label: "Whole result" },
        { featureId: target, outputRole: "pattern.instance.1", label: "Named body" },
      ],
    })
    await userEvent
      .setup()
      .selectOptions(screen.getByRole("combobox", { name: copy.target }), `${target}\u0000`)
    await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: holeFeatureType.type,
        parameters: expect.not.objectContaining({ targetBody: expect.anything() }),
      }),
    )
  })

  it("keeps an unavailable v2 body role visible and blocks save", async () => {
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: holeFeatureId,
      type: holeFeatureTypeV2.type,
      parameters: {
        sketchId: sketch.id,
        pointIds: [validPointId],
        diameter: createLengthQuantity(5),
        direction: "forward",
        extent: "blind",
        depth: createLengthQuantity(10),
        targetBody: { schemaVersion: 0, featureId: target, outputRole: "pattern.instance.9" },
      },
      dependencies: [target],
      references: [],
      suppressed: false,
      label: "Hole 1",
    })
    const onPreviewChange = vi.fn()
    const { onSave } = renderForm({
      mode: { kind: "edit", feature },
      options: [
        {
          featureId: target,
          outputRole: "pattern.instance.9",
          label: "Missing body output",
          missing: true,
        },
      ],
      previewStatus: "ready",
      onPreviewChange,
    })
    expect(screen.getByRole("option", { name: "Missing body output" })).toBeTruthy()
    expect(screen.getByText(copy.missingTargetRole ?? "")).toBeTruthy()
    await vi.waitFor(() => expect(onPreviewChange).toHaveBeenCalledWith(null))
    await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))
    fireEvent.submit(screen.getByRole("form", { name: copy.title }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onPreviewChange.mock.calls.every(([preview]) => preview === null)).toBe(true)
  })

  it("rejects a named target when sketch support is on the same producer", async () => {
    const supportedSketch = sketchRecordSchema.parse({
      ...sketch,
      support: { kind: "feature-face", reference: supportReference },
    })
    const { onSave } = renderForm({
      sketches: [supportedSketch],
      options: [{ featureId: target, outputRole: "pattern.instance.1", label: "Named body" }],
    })
    await fillValidForm()
    await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))
    expect(screen.getByText(copy.incompatibleTarget ?? "")).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it("switches the point list with the selected sketch", async () => {
    const second = sketchRecordSchema.parse({
      ...sketch,
      id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4811"),
      label: "Sketch 2",
      entities: [
        {
          ...sketch.entities[0],
          id: sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4812"),
        },
      ],
    })
    renderForm({ sketches: [sketch, second] })
    await userEvent
      .setup()
      .selectOptions(screen.getByRole("combobox", { name: copy.sketch }), second.id)
    expect(screen.getByText("Point 1")).toBeTruthy()
  })

  it("calls the create id factory once and coalesces duplicate submit activation", async () => {
    const createFeatureId = vi.fn(() => holeFeatureId)
    const onSave = vi.fn(async () => ({ ok: true as const }))
    renderForm({ mode: { kind: "create", createFeatureId, featureLabel: "Hole 1" }, onSave })
    const user = await fillValidForm()
    await user.dblClick(screen.getByRole("button", { name: copy.submit }))
    expect(createFeatureId).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("unlocks after a failed save", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("failed"))
    renderForm({ onSave })
    const user = await fillValidForm()
    await user.click(screen.getByRole("button", { name: copy.submit }))
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it("consumes a matching point request once and exposes feature-scoped context", async () => {
    const onPickingContextChange = vi.fn()
    const pointId = sketch.entities[0]?.id
    if (!pointId) throw new Error("Fixture point is missing.")
    const request = {
      requestId: 1,
      featureId: holeFeatureId,
      sketchId: sketch.id,
      pointId,
    }
    const view = renderForm({ pickingRequest: request, onPickingContextChange })
    await vi.waitFor(() =>
      expect((screen.getByRole("checkbox", { name: /Point 1/ }) as HTMLInputElement).checked).toBe(
        true,
      ),
    )
    expect(onPickingContextChange).toHaveBeenCalledWith(
      expect.objectContaining({ featureId: holeFeatureId, sketchId: sketch.id }),
    )
    view.rerender(
      <I18nProvider i18n={i18n} initialLocale="en">
        <HoleForm
          baseRevision={1}
          copy={copy}
          mode={{ kind: "create", createFeatureId: () => holeFeatureId, featureLabel: "Hole 1" }}
          sketches={[sketch]}
          options={[{ featureId: target, label: "Body" }]}
          variables={[]}
          onCancel={vi.fn()}
          onSave={vi.fn(async () => ({ ok: true as const }))}
          onSaved={vi.fn()}
          pickingRequest={request}
          onPickingContextChange={onPickingContextChange}
        />
      </I18nProvider>,
    )
    expect((screen.getByRole("checkbox", { name: /Point 1/ }) as HTMLInputElement).checked).toBe(
      true,
    )
  })

  it("keeps a missing persisted point visible and blocks editing save", async () => {
    const { onSave } = renderForm({
      mode: { kind: "edit", feature: editFeature({ pointIds: [missingPointId] }) },
    })

    expect(screen.getByText(missingPointId)).toBeTruthy()
    await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(copy.validationSummary)).toBeTruthy()
  })

  it("repairs a missing persisted point by removing it and selecting a valid point", async () => {
    const { onSave } = renderForm({
      mode: { kind: "edit", feature: editFeature({ pointIds: [missingPointId] }) },
    })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: copy.removePoint }))
    await user.click(screen.getByRole("checkbox", { name: /Point 1/ }))
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        parameters: expect.objectContaining({ pointIds: [validPointId] }),
      }),
    )
  })

  it("saves the exact face support reference and deduplicates its dependency", async () => {
    const supportedSketch = sketchRecordSchema.parse({
      ...sketch,
      support: { kind: "feature-face", reference: supportReference },
    })
    const { onSave } = renderForm({ sketches: [supportedSketch] })
    const user = await fillValidForm()

    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ dependencies: [target], references: [supportReference] }),
    )
  })

  it("uses the valid default depth when changing an edited through-all hole to blind", async () => {
    const { onSave } = renderForm({
      mode: {
        kind: "edit",
        feature: editFeature({ extent: "through-all" }),
      },
    })
    const user = userEvent.setup()

    await user.selectOptions(screen.getByRole("combobox", { name: copy.extent }), "blind")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        parameters: expect.objectContaining({
          extent: "blind",
          depth: expect.objectContaining({ value: 10, unit: "mm" }),
        }),
      }),
    )
  })

  it("blocks preview errors for both button and direct form submission", async () => {
    const { onSave } = renderForm({ previewStatus: "error" })
    const user = await fillValidForm()
    const form = screen.getByRole("form", { name: copy.title })

    await user.click(screen.getByRole("button", { name: copy.submit }))
    fireEvent.submit(form)

    expect(onSave).not.toHaveBeenCalled()
  })
})
