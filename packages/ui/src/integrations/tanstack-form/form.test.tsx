import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "../../../../../tests/unit/support/bun-test"

import { Form, useAppForm } from "./index"

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

type FormValue = {
  name: string
}

function FormHarness({ onSubmit }: { onSubmit: (value: FormValue) => Promise<void> }) {
  const form = useAppForm({
    defaultValues: {
      name: "",
    },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <Form form={form} aria-label="Project settings">
      <form.AppField name="name">
        {(field) => <field.TextField label="Project name" />}
      </form.AppField>
      <form.SubmitButton>Save project</form.SubmitButton>
    </Form>
  )
}

afterEach(cleanup)

describe("TanStack Form integration", () => {
  it("binds the uncontrolled field primitive and guards async submission", async () => {
    const user = userEvent.setup()
    const submission = deferred<void>()
    const onSubmit = vi.fn(() => submission.promise)

    render(<FormHarness onSubmit={onSubmit} />)
    const input = screen.getByRole("textbox", { name: "Project name" })
    const submit = screen.getByRole("button", { name: "Save project" }) as HTMLButtonElement

    expect(submit.disabled).toBe(true)

    await user.type(input, "Printer bracket")
    expect(submit.disabled).toBe(false)

    await user.dblClick(submit)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({ name: "Printer bracket" })
    expect(submit.disabled).toBe(true)
    expect(submit.getAttribute("aria-busy")).toBe("true")

    submission.resolve()

    await waitFor(() => {
      expect(submit.disabled).toBe(false)
      expect(submit.getAttribute("aria-busy")).toBeNull()
    })
  })
})

function ValidationHarness() {
  const form = useAppForm({
    defaultValues: { name: "", notes: "", enabled: false, mode: "copy" },
    validators: {
      onSubmit: ({ value }) =>
        value.name.trim()
          ? undefined
          : {
              form: "Correct the highlighted fields.",
              fields: { name: "Name is required." },
            },
    },
  })
  return (
    <Form form={form} aria-label="Validated settings">
      <form.AppField name="name">
        {(field) => <field.TextField label="Name" required />}
      </form.AppField>
      <form.AppField name="notes">{(field) => <field.TextareaField label="Notes" />}</form.AppField>
      <form.AppField name="enabled">
        {(field) => <field.CheckboxField label="Enabled" />}
      </form.AppField>
      <form.AppField name="mode">
        {(field) => (
          <field.ChoiceField
            label="Mode"
            options={[
              { value: "copy", label: "Copy" },
              { value: "reference", label: "Reference" },
            ]}
          />
        )}
      </form.AppField>
      <form.FormError />
      <form.SubmitButton requireDirty={false}>Apply</form.SubmitButton>
    </Form>
  )
}

it("shows submit validation on untouched fields and focuses the first invalid control", async () => {
  const user = userEvent.setup()
  render(<ValidationHarness />)
  await user.click(screen.getByRole("button", { name: "Apply" }))
  const input = screen.getByRole("textbox", { name: "Name" })
  expect(input.getAttribute("aria-invalid")).toBe("true")
  expect(screen.getByText("Name is required.")).toBeTruthy()
  expect(screen.getByText("Correct the highlighted fields.")).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(input))
  await user.type(input, "Bracket")
  await user.click(screen.getByRole("textbox", { name: "Notes" }))
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Notes" }))
  await user.click(screen.getByRole("button", { name: "Apply" }))
  expect(screen.queryByText("Name is required.")).toBeNull()
})

it("binds registered checkbox, choice, and textarea fields to submitted values", async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  function Fields() {
    const form = useAppForm({
      defaultValues: { enabled: false, mode: "copy", notes: "" },
      onSubmit: ({ value }) => onSubmit(value),
    })
    return (
      <Form form={form}>
        <form.AppField name="enabled">
          {(field) => <field.CheckboxField label="Enabled" />}
        </form.AppField>
        <form.AppField name="mode">
          {(field) => (
            <field.ChoiceField
              label="Mode"
              options={[
                { value: "copy", label: "Copy" },
                { value: "reference", label: "Reference" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="notes">
          {(field) => <field.TextareaField label="Notes" />}
        </form.AppField>
        <form.SubmitButton>Save</form.SubmitButton>
      </Form>
    )
  }
  render(<Fields />)
  await user.click(screen.getByRole("checkbox", { name: "Enabled" }))
  await user.click(screen.getByRole("radio", { name: "Reference" }))
  await user.type(screen.getByRole("textbox", { name: "Notes" }), "Keep this draft")
  await user.click(screen.getByRole("button", { name: "Save" }))
  expect(onSubmit).toHaveBeenCalledWith({
    enabled: true,
    mode: "reference",
    notes: "Keep this draft",
  })
})

it("guards repeated native submissions while asynchronous validation is pending", async () => {
  const validation = deferred<void>()
  const onSubmit = vi.fn()
  function AsyncValidation() {
    const form = useAppForm({
      defaultValues: { name: "Bracket" },
      validators: {
        onSubmitAsync: async () => {
          await validation.promise
          return undefined
        },
      },
      onSubmit: () => onSubmit(),
    })
    return (
      <Form form={form} aria-label="Async validation">
        <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
        <form.SubmitButton requireDirty={false}>Save</form.SubmitButton>
      </Form>
    )
  }
  render(<AsyncValidation />)
  const form = screen.getByRole("form", { name: "Async validation" })
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(onSubmit).not.toHaveBeenCalled()
  await act(async () => validation.resolve())
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
})

it("focuses a radio input rather than its invalid fieldset", async () => {
  const user = userEvent.setup()
  function ChoiceValidation() {
    const form = useAppForm({
      defaultValues: { mode: "" },
      validators: {
        onSubmit: ({ value }) => (value.mode ? undefined : { fields: { mode: "Choose a mode." } }),
      },
    })
    return (
      <Form form={form}>
        <form.AppField name="mode">
          {(field) => (
            <field.ChoiceField
              label="Mode"
              options={[
                { value: "copy", label: "Copy" },
                { value: "reference", label: "Reference" },
              ]}
            />
          )}
        </form.AppField>
        <form.SubmitButton requireDirty={false}>Apply</form.SubmitButton>
      </Form>
    )
  }
  render(<ChoiceValidation />)
  await user.click(screen.getByRole("button", { name: "Apply" }))
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Copy" })),
  )
})
