// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  cylinderFeatureType,
  featureIdSchema,
  featureRecordSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { CylinderForm, type CylinderFormMode } from "./cylinder-form"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2612")
const variableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2611")
const variables = [
  { schemaVersion: 0 as const, id: variableId, name: "radius", expression: "12 mm" },
]
const copy = {
  title: "Create cylinder",
  description: "Create a cylindrical solid.",
  parameters: "Cylinder definition",
  dimensions: "Required dimensions",
  radius: "Radius",
  height: "Height",
  placement: "Axis placement origin",
  originX: "Origin X",
  originY: "Origin Y",
  originZ: "Origin Z",
  centered: "Center height about placement origin",
  expressionDescription: "Enter a length or #variable.",
  positionDescription: "Enter a signed coordinate or #variable.",
  submit: "Create cylinder",
  cancel: "Cancel",
  invalidExpression: "Enter a valid expression.",
  invalidDimension: "Expression must resolve to a length.",
  invalidRange: "Enter a positive supported length.",
  invalidPositionRange: "Enter a supported coordinate.",
  validationSummary: "Fix the highlighted dimensions.",
  staleRevision: "The document changed.",
  saveFailed: "The cylinder could not be created.",
} as const

const existingFeature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: cylinderFeatureType.type,
  parameters: {
    radius: createLengthQuantity(12, "mm", "#radius"),
    height: createLengthQuantity(30, "mm", "30 mm"),
    centered: true,
    origin: {
      x: createLengthQuantity(12, "mm", "#radius"),
      y: createLengthQuantity(-6, "mm", "-6 mm"),
      z: createLengthQuantity(10, "mm", "10 mm"),
    },
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Cylinder 1",
})

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function renderForm(
  onSave = vi.fn(async () => ({ ok: true as const })),
  onSaved = vi.fn(),
  mode: CylinderFormMode = {
    kind: "create",
    createFeatureId: () => featureId,
    featureLabel: "Cylinder 1",
  },
) {
  const formCopy =
    mode.kind === "edit"
      ? {
          ...copy,
          title: "Edit cylinder",
          submit: "Update cylinder",
          saveFailed: "Update failed.",
        }
      : copy
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <CylinderForm
        baseRevision={3}
        variables={variables}
        copy={formCopy}
        mode={mode}
        onCancel={vi.fn()}
        onSave={onSave}
        onSaved={onSaved}
      />
    </I18nProvider>,
  )
  return { copy: formCopy, onSave, onSaved }
}

afterEach(cleanup)

describe("CylinderForm", () => {
  it("resolves a document variable and guards asynchronous double submission", async () => {
    const user = userEvent.setup()
    const submission = deferred()
    const onSave = vi.fn(async () => {
      await submission.promise
      return { ok: true as const }
    })
    const { onSaved } = renderForm(onSave)

    const radius = screen.getByRole("combobox", { name: copy.radius })
    await user.clear(radius)
    await user.type(radius, "#radius")
    const create = screen.getByRole("button", { name: copy.submit })
    await user.dblClick(create)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        id: featureId,
        label: "Cylinder 1",
        type: cylinderFeatureType.type,
        parameters: expect.objectContaining({
          radius: expect.objectContaining({
            value: 12,
            source: expect.objectContaining({ expression: "#radius" }),
          }),
          origin: {
            x: expect.objectContaining({ value: 0 }),
            y: expect.objectContaining({ value: 0 }),
            z: expect.objectContaining({ value: 0 }),
          },
        }),
      }),
    )
    expect(create.getAttribute("aria-busy")).toBe("true")

    submission.resolve()
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it("preserves invalid raw input and focuses its adjacent error", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()
    const radius = screen.getByRole("combobox", { name: copy.radius })

    await user.clear(radius)
    await user.type(radius, "#missing")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect((await screen.findByText(copy.invalidExpression)).textContent).toBe(
      copy.invalidExpression,
    )
    expect((radius as HTMLInputElement).value).toBe("#missing")
    expect(document.activeElement).toBe(radius)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("restores source expressions and updates the existing feature identity", async () => {
    const user = userEvent.setup()
    const mode = { kind: "edit", feature: existingFeature } as const
    const { copy: editCopy, onSave, onSaved } = renderForm(undefined, undefined, mode)

    expect((screen.getByRole("combobox", { name: copy.radius }) as HTMLInputElement).value).toBe(
      "#radius",
    )
    expect((screen.getByRole("combobox", { name: copy.height }) as HTMLInputElement).value).toBe(
      "30 mm",
    )
    expect(
      (screen.getByRole("checkbox", { name: copy.centered }) as HTMLInputElement).checked,
    ).toBe(true)
    expect((screen.getByRole("combobox", { name: copy.originX }) as HTMLInputElement).value).toBe(
      "#radius",
    )
    expect((screen.getByRole("combobox", { name: copy.originY }) as HTMLInputElement).value).toBe(
      "-6 mm",
    )
    expect((screen.getByRole("combobox", { name: copy.originZ }) as HTMLInputElement).value).toBe(
      "10 mm",
    )

    const height = screen.getByRole("combobox", { name: copy.height })
    const originZ = screen.getByRole("combobox", { name: copy.originZ })
    await user.clear(height)
    await user.type(height, "42 mm")
    await user.clear(originZ)
    await user.type(originZ, "18 mm")
    await user.dblClick(screen.getByRole("button", { name: editCopy.submit }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        id: existingFeature.id,
        label: existingFeature.label,
        parameters: expect.objectContaining({
          radius: expect.objectContaining({
            source: expect.objectContaining({ expression: "#radius" }),
          }),
          height: expect.objectContaining({
            value: 42,
            source: expect.objectContaining({ expression: "42 mm" }),
          }),
          origin: expect.objectContaining({
            x: expect.objectContaining({
              source: expect.objectContaining({ expression: "#radius" }),
            }),
            y: expect.objectContaining({ value: -6 }),
            z: expect.objectContaining({ value: 18 }),
          }),
        }),
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })
})
