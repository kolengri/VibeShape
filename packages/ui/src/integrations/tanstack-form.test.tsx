// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useAppForm } from "./tanstack-form"

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
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Project name" />}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton>Save project</form.SubmitButton>
      </form.AppForm>
    </form>
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
