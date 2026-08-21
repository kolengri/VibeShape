// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  boxFeatureType,
  createLengthQuantity,
  type DocumentDisplayUnits,
  featureIdSchema,
  featureRecordSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { BoxForm, type BoxFormMode } from "./box-form"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602")
const variableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2601")
const variables = [
  { schemaVersion: 0 as const, id: variableId, name: "width", expression: "24 mm" },
]
const copy = {
  title: "Create box",
  description: "Create a primitive solid.",
  parameters: "Box definition",
  dimensions: "Required dimensions",
  width: "Width",
  depth: "Depth",
  height: "Height",
  placement: "Placement origin",
  originX: "Origin X",
  originY: "Origin Y",
  originZ: "Origin Z",
  centered: "Center height about placement origin",
  expressionDescription: "Enter a length or #variable.",
  positionDescription: "Enter a signed coordinate or #variable.",
  submit: "Create box",
  cancel: "Cancel",
  invalidExpression: "Enter a valid expression.",
  invalidDimension: "Expression must resolve to a length.",
  invalidRange: "Enter a positive supported length.",
  invalidPositionRange: "Enter a supported coordinate.",
  validationSummary: "Fix the highlighted dimensions.",
  staleRevision: "The document changed.",
  saveFailed: "The box could not be created.",
} as const

const existingFeature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(24, "mm", "#width"),
    depth: createLengthQuantity(2, "cm", "2 cm"),
    height: createLengthQuantity(20),
    centered: true,
    origin: {
      x: createLengthQuantity(24, "mm", "#width"),
      y: createLengthQuantity(-5, "mm", "-5 mm"),
      z: createLengthQuantity(2, "cm", "2 cm"),
    },
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Box 1",
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
  mode: BoxFormMode = {
    kind: "create",
    createFeatureId: () => featureId,
    featureLabel: "Box 1",
  },
  displayUnits: DocumentDisplayUnits = { length: "mm", angle: "deg" },
) {
  const formCopy =
    mode.kind === "edit"
      ? { ...copy, title: "Edit box", submit: "Update box", saveFailed: "Update failed." }
      : copy
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <DocumentDisplayUnitsProvider displayUnits={displayUnits}>
        <BoxForm
          baseRevision={2}
          variables={variables}
          copy={formCopy}
          mode={mode}
          onCancel={vi.fn()}
          onSave={onSave}
          onSaved={onSaved}
        />
      </DocumentDisplayUnitsProvider>
    </I18nProvider>,
  )
  return { copy: formCopy, onSave, onSaved }
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock)
afterEach(cleanup)

describe("BoxForm", () => {
  it("resolves a document variable and guards asynchronous double submission", async () => {
    const user = userEvent.setup()
    const submission = deferred()
    const onSave = vi.fn(async () => {
      await submission.promise
      return { ok: true as const }
    })
    const { onSaved } = renderForm(onSave)

    const width = screen.getByRole("combobox", { name: copy.width })
    await user.clear(width)
    await user.type(width, "#wi")
    expect(screen.getByRole("option", { name: /#width/ })).toBeTruthy()
    await user.keyboard("{Enter}")
    expect((width as HTMLInputElement).value).toBe("#width")
    const create = screen.getByRole("button", { name: copy.submit })
    await user.dblClick(create)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        id: featureId,
        label: "Box 1",
        parameters: expect.objectContaining({
          width: expect.objectContaining({
            value: 24,
            source: expect.objectContaining({ expression: "#width" }),
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
    const width = screen.getByRole("combobox", { name: copy.width })

    await user.clear(width)
    await user.type(width, "#missing")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect((await screen.findByText(copy.invalidExpression)).textContent).toBe(
      copy.invalidExpression,
    )
    expect(screen.getByText(copy.validationSummary).textContent).toBe(copy.validationSummary)
    expect((width as HTMLInputElement).value).toBe("#missing")
    expect(document.activeElement).toBe(width)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("uses project units for defaults and normalizes unitless input before persistence", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm(undefined, undefined, undefined, {
      length: "in",
      angle: "deg",
    })
    const width = screen.getByRole("combobox", { name: copy.width }) as HTMLInputElement
    expect(width.value).toBe("0.787401574803 in")
    await user.clear(width)
    await user.type(width, "2")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        parameters: expect.objectContaining({
          width: expect.objectContaining({
            value: 50.8,
            source: expect.objectContaining({ expression: "2 in" }),
          }),
        }),
      }),
    )
  })

  it("restores source expressions and updates the existing feature identity", async () => {
    const user = userEvent.setup()
    const mode = { kind: "edit", feature: existingFeature } as const
    const { copy: editCopy, onSave, onSaved } = renderForm(undefined, undefined, mode)

    expect((screen.getByRole("combobox", { name: copy.width }) as HTMLInputElement).value).toBe(
      "#width",
    )
    expect((screen.getByRole("combobox", { name: copy.depth }) as HTMLInputElement).value).toBe(
      "2 cm",
    )
    expect((screen.getByRole("combobox", { name: copy.height }) as HTMLInputElement).value).toBe(
      "20 mm",
    )
    expect(
      (screen.getByRole("checkbox", { name: copy.centered }) as HTMLInputElement).checked,
    ).toBe(true)
    expect((screen.getByRole("combobox", { name: copy.originX }) as HTMLInputElement).value).toBe(
      "#width",
    )
    expect((screen.getByRole("combobox", { name: copy.originY }) as HTMLInputElement).value).toBe(
      "-5 mm",
    )
    expect((screen.getByRole("combobox", { name: copy.originZ }) as HTMLInputElement).value).toBe(
      "2 cm",
    )

    const depth = screen.getByRole("combobox", { name: copy.depth })
    const originY = screen.getByRole("combobox", { name: copy.originY })
    await user.clear(depth)
    await user.type(depth, "28 mm")
    await user.clear(originY)
    await user.type(originY, "-12 mm")
    await user.dblClick(screen.getByRole("button", { name: editCopy.submit }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        id: existingFeature.id,
        label: existingFeature.label,
        parameters: expect.objectContaining({
          width: expect.objectContaining({
            source: expect.objectContaining({ expression: "#width" }),
          }),
          depth: expect.objectContaining({
            value: 28,
            source: expect.objectContaining({ expression: "28 mm" }),
          }),
          origin: expect.objectContaining({
            x: expect.objectContaining({
              source: expect.objectContaining({ expression: "#width" }),
            }),
            y: expect.objectContaining({ value: -12 }),
            z: expect.objectContaining({ value: 20 }),
          }),
        }),
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })
})
