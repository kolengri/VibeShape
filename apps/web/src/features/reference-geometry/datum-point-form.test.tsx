import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  type BodyTopoRef,
  type BodyVertexRef,
  createLengthQuantity,
  datumPointFeatureType,
  type FeatureRecord,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ComponentProps } from "react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n, messages } from "../../i18n"
import { DatumPointForm, type DatumPointFormCopy } from "./datum-point-form"
import type { DatumPointOptions } from "./datum-point-options"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5101")
const ownerId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f5102")
const catalog = messages.en.app.shell.taskPanel.datumPoint
const copy: DatumPointFormCopy = {
  ...catalog,
  title: catalog.title,
  description: catalog.description,
  submit: catalog.create,
  saveFailed: catalog.createFailed,
}
const vertex = {
  schemaVersion: 1,
  featureId: ownerId,
  outputRole: "result",
  kind: "vertex",
  semanticRole: "primitive.box.vertex.7",
  signature: {
    kind: "vertex",
    geometryClass: "POINT",
    measure: 0,
    centroid: [10, 20, 30],
    bounds: { min: [10, 20, 30], max: [10, 20, 30] },
    boundaryCount: 0,
    adjacentGeometryClasses: [],
  },
} as BodyVertexRef
const circle = {
  ...vertex,
  kind: "edge",
  semanticRole: "primitive.cylinder.edge.end",
  signature: { ...vertex.signature, kind: "edge", geometryClass: "CIRCLE", measure: 12 },
} as BodyTopoRef
const options: DatumPointOptions = {
  vertices: [
    { key: "v", label: "Box 1 · result · corner", position: [10, 20, 30], reference: vertex },
  ],
  circles: [{ key: "c", label: "Cylinder · result · rim", position: [1, 2, 3], reference: circle }],
}

function renderForm(overrides: Partial<ComponentProps<typeof DatumPointForm>> = {}) {
  const onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({
    ok: true as const,
  }))
  const onPreviewChange = vi.fn()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <DatumPointForm
        baseRevision={4}
        copy={copy}
        mode={{ kind: "create", createFeatureId: () => featureId, featureLabel: "Datum point 1" }}
        options={options}
        savedStatus={null}
        variables={[]}
        onCancel={vi.fn()}
        onSave={onSave}
        onSaved={vi.fn()}
        onPreviewChange={onPreviewChange}
        previewStatus="ready"
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onSave, onPreviewChange }
}

async function setLength(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const field = screen.getByRole("combobox", { name: label })
  await user.clear(field)
  await user.type(field, value)
}

afterEach(cleanup)

describe("DatumPointForm", () => {
  it("previews and saves explicit coordinates without dependencies", async () => {
    const user = userEvent.setup()
    const { onSave, onPreviewChange } = renderForm()
    await setLength(user, copy.x, "-15")
    await setLength(user, copy.y, "2 cm")
    await setLength(user, copy.z, "7 mm")
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: featureId, type: datumPointFeatureType.type }),
      ),
    )
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        type: datumPointFeatureType.type,
        dependencies: [],
        references: [],
        parameters: {
          mode: "coordinates",
          position: {
            x: expect.objectContaining({ value: -15 }),
            y: expect.objectContaining({ value: 20 }),
            z: expect.objectContaining({ value: 7 }),
          },
        },
      }),
    )
  })

  it("rejects coordinates outside the workspace", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()
    await setLength(user, copy.x, "100001 mm")
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(screen.getByRole("combobox", { name: copy.x }).getAttribute("aria-invalid")).toBe("true")
    expect(onSave).not.toHaveBeenCalled()
  })

  it.each([
    ["vertex", copy.modeVertex, copy.vertex, "v", vertex],
    ["circle-center", copy.modeCircleCenter, copy.circle, "c", circle],
  ] as const)(
    "persists a chosen %s reference and depends only on its producer",
    async (mode, modeLabel, fieldLabel, key, reference) => {
      const user = userEvent.setup()
      const { onSave } = renderForm()
      await user.selectOptions(screen.getByRole("combobox", { name: copy.mode }), modeLabel)
      await user.click(screen.getByRole("button", { name: copy.submit }))
      expect(onSave).not.toHaveBeenCalled()
      await user.selectOptions(screen.getByRole("combobox", { name: fieldLabel }), key)
      await user.click(screen.getByRole("button", { name: copy.submit }))
      expect(onSave).toHaveBeenCalledWith(
        4,
        expect.objectContaining({
          dependencies: [ownerId],
          references: [],
          parameters: { mode, reference },
        }),
      )
    },
  )

  it("blocks saving a missing saved reference until it is explicitly replaced", async () => {
    const user = userEvent.setup()
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureId,
      type: datumPointFeatureType.type,
      parameters: { mode: "vertex", reference: vertex },
      dependencies: [ownerId],
      references: [],
      suppressed: false,
      label: "Datum point 1",
    })
    const { onSave } = renderForm({
      mode: { kind: "edit", feature },
      savedStatus: "missing",
      options: { vertices: [], circles: [] },
    })
    const select = screen.getByRole("combobox", { name: copy.vertex }) as HTMLSelectElement
    expect(select.value).toBe("saved")
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByText(copy.unavailableReference).length).toBeGreaterThan(0)
  })

  it("keeps a resolved saved reference and coordinate expressions unchanged on edit", async () => {
    const user = userEvent.setup()
    const feature = featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureId,
      type: datumPointFeatureType.type,
      parameters: { mode: "circle-center", reference: circle },
      dependencies: [ownerId],
      references: [],
      suppressed: false,
      label: "Datum point 1",
    })
    const { onSave } = renderForm({ mode: { kind: "edit", feature }, savedStatus: "resolved" })
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ parameters: feature.parameters }),
    )
    cleanup()
    const coordinates = featureRecordSchema.parse({
      ...feature,
      parameters: {
        mode: "coordinates",
        position: {
          x: createLengthQuantity(1, "mm", "#x"),
          y: createLengthQuantity(2),
          z: createLengthQuantity(3),
        },
      },
      dependencies: [],
    })
    renderForm({ mode: { kind: "edit", feature: coordinates } })
    expect((screen.getByRole("combobox", { name: copy.x }) as HTMLInputElement).value).toBe("#x")
  })
})
