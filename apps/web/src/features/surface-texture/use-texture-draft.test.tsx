import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { surfaceTextureProjectFixture } from "../../../../../tests/fixtures/surface-texture-project"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import { useTextureDraft } from "./use-texture-draft"

afterEach(cleanup)

it("retains texture edits across rerenders and validates the current draft before submission", async () => {
  const fixture = surfaceTextureProjectFixture()
  const controller: DocumentControllerState = {
    status: "idle",
    report: null,
    saveStatus: "saved",
    diagnostic: null,
  }
  const submit = vi.fn(async () => {})
  function Editor() {
    const state = useTextureDraft(
      controller,
      null,
      { featureId: fixture.layer.featureId, outputRole: "result" },
      submit,
    )
    return (
      <Form form={state.form} aria-label="Texture draft">
        <output aria-label="Layer identity">{state.layer?.id}</output>
        <output aria-label="Height">{state.layer?.heightMm}</output>
        <button type="button" onClick={() => state.update({ heightMm: -1 })}>
          Invalid height
        </button>
        <button type="button" onClick={() => state.update({ heightMm: 0.8 })}>
          Valid height
        </button>
        <state.form.FormError />
        <button type="submit">Apply</button>
      </Form>
    )
  }
  const view = () => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <Editor />
    </I18nProvider>
  )
  const rendered = render(view())
  const initialId = screen.getByLabelText("Layer identity").textContent
  fireEvent.click(screen.getByRole("button", { name: "Invalid height" }))
  fireEvent.click(screen.getByRole("button", { name: "Apply" }))
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
  expect(submit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Valid height" }))
  rendered.rerender(view())
  expect(screen.getByLabelText("Height").textContent).toBe("0.8")
  expect(screen.getByLabelText("Layer identity").textContent).toBe(initialId)
  fireEvent.click(screen.getByRole("button", { name: "Apply" }))
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
})

it("does not start a texture mutation after the task is dismissed during validation", async () => {
  const fixture = surfaceTextureProjectFixture()
  const controller: DocumentControllerState = {
    status: "idle",
    report: null,
    saveStatus: "saved",
    diagnostic: null,
  }
  const submit = vi.fn(async () => {})
  const rendered = renderHook(
    () =>
      useTextureDraft(
        controller,
        null,
        {
          featureId: fixture.layer.featureId,
          outputRole: "result",
        },
        submit,
      ),
    {
      wrapper: ({ children }) => (
        <I18nProvider i18n={i18n} initialLocale="en">
          {children}
        </I18nProvider>
      ),
    },
  )
  let submission = Promise.resolve()
  act(() => {
    submission = rendered.result.current.form.handleSubmit()
  })
  rendered.unmount()
  await act(() => submission)
  expect(submit).not.toHaveBeenCalled()
})
