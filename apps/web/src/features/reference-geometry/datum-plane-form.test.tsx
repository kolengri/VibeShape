// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  type FeatureRecord,
  featureIdSchema,
  sketchFeatureFaceSupportSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { DatumPlaneForm, type DatumPlaneFormMode } from "./datum-plane-form"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const datumId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2701")
const supportId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2702")
const variableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2703")
const variables = [
  { schemaVersion: 0 as const, id: variableId, name: "planeOffset", expression: "-12 mm" },
]
const copy = {
  title: "Create datum plane",
  description: "Create a reusable sketch support.",
  parameters: "Plane definition",
  support: "Support",
  supportDescription: "Choose an origin plane or selected model face.",
  selectedFace: "Selected model face",
  planeXy: "XY plane",
  planeXz: "XZ plane",
  planeYz: "YZ plane",
  offset: "Offset",
  expressionDescription: "Enter a signed length or #variable.",
  submit: "Create datum plane",
  cancel: "Cancel",
  invalidExpression: "Enter a valid expression.",
  invalidDimension: "Expression must resolve to a length.",
  invalidRange: "Enter a supported offset.",
  validationSummary: "Fix the highlighted offset.",
  staleRevision: "The document changed.",
  saveFailed: "The datum plane could not be created.",
} as const

function renderForm(
  mode: DatumPlaneFormMode,
  onPreviewChange?: (feature: FeatureRecord | null) => void,
) {
  const onSave = vi.fn(async () => ({ ok: true as const }))
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <DatumPlaneForm
        baseRevision={4}
        copy={copy}
        mode={mode}
        variables={variables}
        onCancel={vi.fn()}
        {...(onPreviewChange ? { onPreviewChange } : {})}
        onSave={onSave}
        onSaved={vi.fn()}
      />
    </I18nProvider>,
  )
  return onSave
}

const faceSupport = sketchFeatureFaceSupportSchema.parse({
  kind: "feature-face",
  reference: {
    schemaVersion: 0,
    featureId: supportId,
    kind: "face",
    semanticRole: "primitive.box.cap.end",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 400,
      centroid: [0, 0, 20],
      bounds: { min: [-10, -10, 20], max: [10, 10, 20] },
      direction: [0, 0, 1],
      directionMode: "oriented",
      boundaryCount: 4,
      adjacentGeometryClasses: ["PLANE"],
    },
  },
})

vi.stubGlobal("ResizeObserver", ResizeObserverMock)
afterEach(cleanup)

describe("DatumPlaneForm", () => {
  it("creates a variable-driven signed offset from a selected origin plane", async () => {
    const user = userEvent.setup()
    const onSave = renderForm({
      kind: "create",
      createFeatureId: () => datumId,
      featureLabel: "Datum plane 1",
    })
    await user.selectOptions(screen.getByRole("combobox", { name: copy.support }), "xz")
    const offset = screen.getByRole("combobox", { name: copy.offset })
    await user.clear(offset)
    await user.type(offset, "#planeOffset")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        dependencies: [],
        references: [],
        parameters: expect.objectContaining({
          support: { kind: "origin-plane", plane: "xz" },
          offset: expect.objectContaining({ value: -12 }),
        }),
      }),
    )
  })

  it("locks a selected planar face into matching feature dependencies and references", async () => {
    const user = userEvent.setup()
    const onSave = renderForm({
      kind: "create",
      createFeatureId: () => datumId,
      featureLabel: "Datum plane 1",
      support: faceSupport,
    })
    expect(
      (screen.getByRole("combobox", { name: copy.support }) as HTMLSelectElement).disabled,
    ).toBe(true)
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        dependencies: [supportId],
        references: [faceSupport.reference],
        parameters: expect.objectContaining({
          support: { kind: "feature-face", reference: faceSupport.reference },
        }),
      }),
    )
  })

  it("publishes one stable variable-aware feature identity for live preview", async () => {
    const user = userEvent.setup()
    const onPreviewChange = vi.fn()
    renderForm(
      {
        kind: "create",
        createFeatureId: () => datumId,
        featureLabel: "Datum plane 1",
      },
      onPreviewChange,
    )

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: datumId, parameters: expect.objectContaining({}) }),
      ),
    )
    const offset = screen.getByRole("combobox", { name: copy.offset })
    await user.clear(offset)
    await user.type(offset, "#planeOffset")
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: datumId,
          parameters: expect.objectContaining({ offset: expect.objectContaining({ value: -12 }) }),
        }),
      ),
    )
  })
})
