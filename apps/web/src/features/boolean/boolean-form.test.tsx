import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { booleanFeatureType, featureIdSchema, featureRecordSchema } from "@vibeshape/domain"
import { bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import { booleanFeatureTypeV2 } from "@vibeshape/domain/part-design-subtract"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { exactBodyOptionId } from "../part-design/exact-body-options"
import { currentBodyOptions } from "../part-design/exact-body-options.test-fixtures"
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
  keepTools: "Keep tool solid",
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
  inputOptions: readonly BooleanInputOption[] = options,
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
      options={inputOptions}
      onCancel={vi.fn()}
      onSave={onSave}
      onSaved={onSaved}
    />,
  )
  return { copy: formCopy, onSave, onSaved }
}

afterEach(cleanup)

describe("BooleanForm", () => {
  it.each([["result"], ["pattern.instance.0", "pattern.instance.1"]].map((roles) => ({ roles })))(
    "retains legacy whole-producer scope from current collector options with %j roles",
    async ({ roles }) => {
      const user = userEvent.setup()
      const producers = [ids.box, ids.cylinder].map((id) => ({
        ...existingFeature,
        id,
        dependencies: [],
        label: id === ids.box ? "Target" : "Tool",
      }))
      const collected = currentBodyOptions([...producers, existingFeature], existingFeature, roles)
      const { onSave, copy: formCopy } = renderForm(
        undefined,
        undefined,
        { kind: "edit", feature: existingFeature },
        collected,
      )
      expect((screen.getByRole("combobox", { name: copy.target }) as HTMLSelectElement).value).toBe(
        ids.box,
      )
      await user.click(screen.getByRole("button", { name: formCopy.submit }))
      expect(onSave).toHaveBeenLastCalledWith(4, existingFeature)
      const exact = collected.filter((option) => option.body)
      const target = exact[0]
      const tool = exact.find(({ body }) => body?.featureId === ids.cylinder)
      if (!target || !tool) throw new Error("Expected explicit target and tool body choices.")
      await user.selectOptions(screen.getByRole("combobox", { name: copy.target }), target.id)
      await user.selectOptions(screen.getByRole("combobox", { name: copy.tool }), tool.id)
      await user.click(screen.getByRole("button", { name: formCopy.submit }))
      expect(onSave).toHaveBeenLastCalledWith(
        4,
        expect.objectContaining({
          type: booleanFeatureTypeV2.type,
          parameters: expect.objectContaining({ targetBody: target.body }),
        }),
      )
    },
  )
  it("saves tool retention and restores it when editing", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()
    const keepTools = screen.getByRole("checkbox", { name: copy.keepTools })
    expect((keepTools as HTMLInputElement).checked).toBe(false)
    await user.click(keepTools)
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ parameters: { operation: "subtract", keepTools: true } }),
    )
    cleanup()
    const edited = renderForm(undefined, undefined, {
      kind: "edit",
      feature: { ...existingFeature, parameters: { operation: "subtract", keepTools: true } },
    })
    expect(
      (screen.getByRole("checkbox", { name: copy.keepTools }) as HTMLInputElement).checked,
    ).toBe(true)
    await user.click(screen.getByRole("checkbox", { name: copy.keepTools }))
    await user.click(screen.getByRole("button", { name: edited.copy.submit }))
    expect(edited.onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ parameters: { operation: "subtract" } }),
    )
  })
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
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it("allows repairing a saved subtraction with invalid retention parameters", async () => {
    const user = userEvent.setup()
    const { copy: editCopy, onSave } = renderForm(undefined, undefined, {
      kind: "edit",
      feature: { ...existingFeature, parameters: { operation: "subtract", keepTools: "true" } },
    })
    expect(
      (screen.getByRole("checkbox", { name: copy.keepTools }) as HTMLInputElement).checked,
    ).toBe(false)
    await user.click(screen.getByRole("button", { name: editCopy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ parameters: { operation: "subtract" } }),
    )
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
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })
})

describe("exact-body Boolean form", () => {
  const exactOptions = [0, 1].map((index) => {
    const body = bodyReferenceSchema.parse({
      schemaVersion: 0,
      featureId: ids.box,
      outputRole: `pattern.instance.${index}`,
    })
    return { id: exactBodyOptionId(body), body, label: `Body ${index + 1}` }
  })
  it("previews and saves two distinct roles from one producer, then restores the authored inputs", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(
      async (_revision: number, _feature: ReturnType<typeof featureRecordSchema.parse>) => ({
        ok: true as const,
      }),
    )
    const onPreviewChange = vi.fn()
    const mode = {
      kind: "create" as const,
      createFeatureId: () => ids.boolean,
      featureLabel: "Subtract 1",
    }
    const view = render(
      <BooleanForm
        baseRevision={4}
        copy={copy}
        mode={mode}
        options={exactOptions}
        onCancel={vi.fn()}
        onSave={onSave}
        onSaved={vi.fn()}
        onPreviewChange={onPreviewChange}
      />,
    )
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: booleanFeatureTypeV2.type,
          dependencies: [ids.box],
          parameters: {
            operation: "subtract",
            targetBody: exactOptions[0]?.body,
            toolBody: exactOptions[1]?.body,
          },
        }),
      ),
    )
    await user.click(screen.getByRole("checkbox", { name: copy.keepTools }))
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        type: booleanFeatureTypeV2.type,
        dependencies: [ids.box],
        parameters: {
          operation: "subtract",
          keepTools: true,
          targetBody: exactOptions[0]?.body,
          toolBody: exactOptions[1]?.body,
        },
      }),
    )
    const saved = onSave.mock.calls[0]?.[1]
    view.unmount()
    if (!saved) throw new Error("Expected saved exact-body feature.")
    renderForm(undefined, undefined, { kind: "edit", feature: saved }, exactOptions)
    expect(
      (screen.getByRole("combobox", { name: copy.tool }) as HTMLSelectElement).value,
    ).toBe<unknown>(exactOptions[1]?.id)
  })
})

it("releases Subtract submission after a rejected save and permits a successful retry", async () => {
  const user = userEvent.setup()
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error("Save failed"))
    .mockResolvedValue({ ok: true })
  const { onSaved } = renderForm(onSave)
  const submit = screen.getByRole("button", { name: copy.submit })
  await user.click(submit)
  await screen.findByText(copy.saveFailed)
  expect((submit as HTMLButtonElement).disabled).toBe(false)
  await user.click(submit)
  expect(onSave).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
})
