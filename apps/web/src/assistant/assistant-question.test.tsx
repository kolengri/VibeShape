import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { AssistantQuestion } from "@vibeshape/automation-api/assistant"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { useState } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { AssistantPanel } from "./assistant-panel"

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn()
})
afterEach(cleanup)

const question: AssistantQuestion = {
  requestId: "question",
  message: "Choose the finish",
  expiresAt: 1,
  fields: [
    {
      id: "finish",
      label: "Finish",
      required: true,
      secret: false,
      allowCustomAnswer: true,
      options: [
        { id: "round", name: "Round" },
        { id: "square", name: "Square" },
      ],
    },
    { id: "note", label: "Notes", required: false, secret: false },
  ],
}

function Harness({
  answer,
}: {
  answer: (value: Record<string, string> | null) => Promise<boolean>
}) {
  const [active, setActive] = useState<AssistantQuestion | null>(null)
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <button type="button" onClick={() => setActive(question)}>
        Ask
      </button>
      <AssistantPanel
        open
        busy={Boolean(active)}
        canSend
        messages={[]}
        configuration={null}
        error={null}
        storageFailed={false}
        onClose={() => {}}
        onReset={async () => {}}
        onSend={async () => true}
        onCancel={async () => {}}
        question={active}
        onAnswer={async (answers) => {
          const accepted = await answer(answers)
          if (accepted) setActive(null)
          return accepted
        }}
      />
    </I18nProvider>
  )
}

it("combines choices and custom text in the composer, preserves answers through Back, and restores the unsent draft", async () => {
  const answer = vi.fn(async () => true)
  render(<Harness answer={answer} />)
  const draft = screen.getByRole("textbox", { name: "Message" })
  fireEvent.change(draft, { target: { value: "Keep this unsent instruction" } })
  await userEvent.click(screen.getByRole("button", { name: "Ask" }))
  const form = screen.getByRole("form", { name: "Agent question" })
  expect(form.closest('section[aria-label="Message"]')).toBeTruthy()
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull()
  expect(screen.getByText("Question 1 of 2")).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(answer).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("radio", { name: "Round" }))
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), "Use 2 mm")
  await userEvent.click(screen.getByRole("button", { name: "Back" }))
  expect((screen.getByRole("radio", { name: "Round" }) as HTMLInputElement).checked).toBe(true)
  await userEvent.type(screen.getByRole("textbox", { name: "Custom answer for Finish" }), "Beveled")
  expect((screen.getByRole("radio", { name: "Round" }) as HTMLInputElement).checked).toBe(false)
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLInputElement).value).toBe(
    "Use 2 mm",
  )
  expect(answer).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))
  await waitFor(() => expect(answer).toHaveBeenCalledWith({ finish: "Beveled", note: "Use 2 mm" }))
  expect(screen.getByRole("textbox", { name: "Message" })).toBe(draft)
  expect((draft as HTMLTextAreaElement).value).toBe("Keep this unsent instruction")
})

it("releases the submission lock after rejection, retains answers, and never submits a question twice", async () => {
  let reject: (reason: Error) => void = () => {}
  const answer = vi.fn(
    () =>
      new Promise<boolean>((_resolve, fail) => {
        reject = fail
      }),
  )
  render(<Harness answer={answer} />)
  await userEvent.click(screen.getByRole("button", { name: "Ask" }))
  await userEvent.click(screen.getByRole("radio", { name: "Square" }))
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  const form = screen.getByRole("form", { name: "Agent question" })
  fireEvent.submit(form)
  fireEvent.submit(form)
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(1))
  expect(form.getAttribute("aria-busy")).toBe("true")
  await act(async () => {
    reject(new Error("Try again"))
  })
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("not accepted"))
  expect(screen.getByRole("button", { name: "Submit answers" }).hasAttribute("disabled")).toBe(
    false,
  )
  await userEvent.click(screen.getByRole("button", { name: "Back" }))
  expect((screen.getByRole("radio", { name: "Square" }) as HTMLInputElement).checked).toBe(true)
})

it.each(["round", "rounded"])(
  "preserves custom text %s when it matches or passes through an option ID",
  async (text) => {
    const answer = vi.fn(async () => true)
    render(<Harness answer={answer} />)
    await userEvent.click(screen.getByRole("button", { name: "Ask" }))
    await userEvent.type(screen.getByRole("textbox", { name: "Custom answer for Finish" }), text)
    expect(
      (screen.getByRole("textbox", { name: "Custom answer for Finish" }) as HTMLTextAreaElement)
        .value,
    ).toBe(text)
    expect((screen.getByRole("radio", { name: "Round" }) as HTMLInputElement).checked).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Next" }))
    await userEvent.click(screen.getByRole("button", { name: "Back" }))
    const custom = screen.getByRole("textbox", {
      name: "Custom answer for Finish",
    }) as HTMLTextAreaElement
    expect(custom.value).toBe(text)
    expect((screen.getByRole("radio", { name: "Round" }) as HTMLInputElement).checked).toBe(false)
    await userEvent.click(screen.getByRole("radio", { name: "Square" }))
    expect(custom.value).toBe("")
    expect((screen.getByRole("radio", { name: "Square" }) as HTMLInputElement).checked).toBe(true)
    await userEvent.type(custom, text)
    expect((screen.getByRole("radio", { name: "Square" }) as HTMLInputElement).checked).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Next" }))
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith({ finish: text }))
  },
)

it("allows skipping unanswered required fields without treating a choice as submitted", async () => {
  const answer = vi.fn(async () => true)
  render(<Harness answer={answer} />)
  await userEvent.click(screen.getByRole("button", { name: "Ask" }))
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(answer).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "Skip question" }))
  await waitFor(() => expect(answer).toHaveBeenCalledWith(null))
})
