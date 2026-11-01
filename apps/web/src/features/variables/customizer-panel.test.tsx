import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { variableDefinitionsSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { applyVariableTable } from "../../document/document-controller"
import { i18n } from "../../i18n"
import { ReadyCustomizerPanel } from "./customizer-panel"

afterEach(cleanup)
const variables = variableDefinitionsSchema.parse([
  {
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2601",
    name: "width",
    expression: "20 mm",
    customizer: {
      dimension: "length",
      group: "Size",
      min: 10,
      max: 100,
      step: 1,
      configurations: { Small: 20, Large: 80 },
    },
  },
  {
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2602",
    name: "half",
    expression: "#width / 2",
  },
])
function setup(
  disabled = false,
  onApply = vi.fn<typeof applyVariableTable>(async () => ({ ok: true as const })),
) {
  render(
    <I18nProvider i18n={i18n}>
      <ReadyCustomizerPanel
        variables={variables}
        baseRevision={7}
        disabled={disabled}
        closeAction={null}
        onApply={onApply}
      />
    </I18nProvider>,
  )
  return onApply
}
it("keeps slider changes local until one revision-checked apply and preserves dependent expressions", async () => {
  const apply = setup()
  fireEvent.change(screen.getByRole("slider", { name: "width (mm)" }), { target: { value: "40" } })
  expect(apply).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "Apply customizer changes" }))
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
  expect(apply.mock.calls[0]?.[0]).toBe(7)
  expect(apply.mock.calls[0]?.[1]).toMatchObject([
    { expression: "40 mm", customizer: { configurations: { Small: 20 } } },
    { expression: "#width / 2" },
  ])
})
it("allows an incomplete numeric edit but prevents committing it until it is valid", async () => {
  const apply = setup()
  const input = screen.getByRole("spinbutton", { name: "Value for width" })
  const user = userEvent.setup()
  await user.clear(input)
  expect(
    (screen.getByRole("button", { name: "Apply customizer changes" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  await user.type(input, "40")
  expect((input as HTMLInputElement).value).toBe("40")
  await user.click(screen.getByRole("button", { name: "Apply customizer changes" }))
  expect(apply.mock.calls[0]?.[1]).toMatchObject([
    { expression: "40 mm" },
    { expression: "#width / 2" },
  ])
})

it("applies a saved configuration as one whole-table change", async () => {
  const apply = setup()
  await userEvent.click(screen.getByRole("button", { name: "Apply configuration Large" }))
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
  expect(apply.mock.calls[0]?.[1]).toMatchObject([
    { expression: "80 mm" },
    { expression: "#width / 2" },
  ])
})
it("prevents writes in read-only mode", () => {
  setup(true)
  expect(
    (screen.getByRole("button", { name: "Apply customizer changes" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  expect(
    (screen.getByRole("button", { name: "Apply configuration Large" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  expect((screen.getByRole("slider") as HTMLInputElement).matches(":disabled")).toBe(true)
})
it("shows a stale revision failure without reporting a successful save", async () => {
  const apply = vi.fn<typeof applyVariableTable>(async () => ({
    ok: false as const,
    diagnostic: {
      code: "command-rejected",
      message: "The document changed. Reopen the customizer.",
      retryable: true,
      sourceCode: "stale-revision",
    },
  }))
  render(
    <I18nProvider i18n={i18n}>
      <ReadyCustomizerPanel
        variables={variables}
        baseRevision={7}
        disabled={false}
        closeAction={null}
        onApply={apply}
      />
    </I18nProvider>,
  )
  await userEvent.click(screen.getByRole("button", { name: "Apply configuration Large" }))
  expect(await screen.findByText("The document changed. Reopen the customizer.")).toBeTruthy()
  expect(screen.queryByText("Customizer saved.")).toBeNull()
})
