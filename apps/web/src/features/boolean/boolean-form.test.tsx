// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { booleanFeatureType, featureIdSchema, featureRecordSchema } from "@vibeshape/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BooleanForm, type BooleanFormMode, type BooleanInputOption } from "./boolean-form"

const ids = {
  box: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2801"),
  cylinder: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2802"),
  secondCylinder: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2803"),
  boolean: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2804"),
}

const options: readonly BooleanInputOption[] = [
  { id: ids.box, label: "Box 1" },
  { id: ids.cylinder, label: "Cylinder 1" },
  { id: ids.secondCylinder, label: "Cylinder 2" },
]

const copy = {
  title: "Subtract solids",
  description: "Remove the tool solid from the target solid.",
  inputs: "Ordered inputs",
  target: "Target solid",
  tool: "Tool solid",
  targetDescription: "The solid that remains after subtraction.",
  toolDescription: "The solid removed from the target.",
  submit: "Subtract",
  cancel: "Cancel",
  missingInput: "Choose an available solid.",
  sameInput: "Choose a different solid.",
  validationSummary: "Choose two different solids.",
  staleRevision: "The document changed.",
  saveFailed: "The subtraction could not be created.",
} as const

const existingFeature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: ids.boolean,
  type: booleanFeatureType.type,
  parameters: { operation: "subtract" },
  dependencies: [ids.box, ids.cylinder],
  references: [],
  suppressed: false,
  label: "Subtract 1",
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
  mode: BooleanFormMode = {
    kind: "create",
    createFeatureId: () => ids.boolean,
    featureLabel: "Subtract 1",
  },
) {
  const formCopy =
    mode.kind === "edit"
      ? { ...copy, title: "Edit subtraction", submit: "Update subtraction" }
      : copy
  render(
    <BooleanForm
      baseRevision={4}
      copy={formCopy}
      mode={mode}
      options={options}
      onCancel={vi.fn()}
      onSave={onSave}
      onSaved={onSaved}
    />,
  )
  return { copy: formCopy, onSave, onSaved }
}

afterEach(cleanup)

describe("BooleanForm", () => {
  it("creates ordered subtraction dependencies and guards asynchronous double submission", async () => {
    const user = userEvent.setup()
    const submission = deferred()
    const onSave = vi.fn(async () => {
      await submission.promise
      return { ok: true as const }
    })
    const { onSaved } = renderForm(onSave)

    const submit = screen.getByRole("button", { name: copy.submit })
    await user.dblClick(submit)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        id: ids.boolean,
        label: "Subtract 1",
        type: booleanFeatureType.type,
        parameters: { operation: "subtract" },
        dependencies: [ids.box, ids.cylinder],
      }),
    )
    expect(submit.getAttribute("aria-busy")).toBe("true")

    submission.resolve()
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it("preserves the invalid selection and focuses its adjacent error", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()
    const tool = screen.getByRole("combobox", { name: copy.tool })

    await user.selectOptions(tool, ids.box)
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect((await screen.findByText(copy.sameInput)).textContent).toBe(copy.sameInput)
    expect((tool as HTMLSelectElement).value).toBe(ids.box)
    expect(document.activeElement).toBe(tool)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("restores ordered inputs and updates the existing feature identity", async () => {
    const user = userEvent.setup()
    const mode = { kind: "edit", feature: existingFeature } as const
    const { copy: editCopy, onSave, onSaved } = renderForm(undefined, undefined, mode)

    expect((screen.getByRole("combobox", { name: copy.target }) as HTMLSelectElement).value).toBe(
      ids.box,
    )
    const tool = screen.getByRole("combobox", { name: copy.tool }) as HTMLSelectElement
    expect(tool.value).toBe(ids.cylinder)
    await user.selectOptions(tool, ids.secondCylinder)
    await user.dblClick(screen.getByRole("button", { name: editCopy.submit }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        id: existingFeature.id,
        label: existingFeature.label,
        dependencies: [ids.box, ids.secondCylinder],
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })
})
