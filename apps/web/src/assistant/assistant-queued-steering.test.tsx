import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it } from "bun:test"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { AssistantComposer, type AssistantComposerProps } from "./assistant-composer"

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function composer(props: Partial<AssistantComposerProps> = {}) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <AssistantComposer
          draft={{ text: "Unsent composer text", attachments: [] }}
          onDraftChange={() => {}}
          busy
          canSend
          onSend={async () => true}
          onCancel={async () => {}}
          queuedMessages={[
            { id: "first", text: "First queued" },
            { id: "second", text: "Second queued" },
          ]}
          {...props}
        />
      </TooltipProvider>
    </I18nProvider>
  )
}

it.each([false, true])("explains unavailable queued steering with active turn=%s", async (busy) => {
  const steer = vi.fn().mockResolvedValue(true)
  render(composer({ busy, supportsActiveSteer: !busy, onSteerQueued: steer }))
  const explanation = busy
    ? "This agent does not support steering an active turn. The message will stay queued."
    : "Steering is available only while the agent is working."
  expect(screen.getByText(explanation)).toBeTruthy()
  for (const button of screen.getAllByRole("button", { name: "Steer now" })) {
    expect(button.hasAttribute("disabled")).toBe(true)
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByText(explanation).id)
    await userEvent.click(button)
  }
  expect(steer).not.toHaveBeenCalled()
  expect(screen.getByText("First queued")).toBeTruthy()
})

it("keeps queued steering unavailable while a supported agent is stopping", () => {
  const steer = vi.fn().mockResolvedValue(true)
  render(composer({ supportsActiveSteer: true, activeSteerTurn: false, onSteerQueued: steer }))
  expect(screen.getByText("Steering is available only while the agent is working.")).toBeTruthy()
  expect(
    screen
      .getAllByRole("button", { name: "Steer now" })
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true)
})

it("uses an accessible shared icon action and supports keyboard steering", async () => {
  const steer = vi.fn().mockResolvedValue(true)
  render(composer({ supportsActiveSteer: true, onSteerQueued: steer }))
  const action = screen.getAllByRole("button", { name: "Steer now" })[0]
  if (!action) throw new Error("Missing queued steering action.")
  expect(action.querySelector("svg[aria-hidden=true]")).toBeTruthy()
  expect(action.textContent).toBe("")
  await act(async () => action.focus())
  await userEvent.keyboard("{Enter}")
  expect(steer).toHaveBeenCalledWith("first")
})

it("locks promotion and its removal while pending, retains queue content on failure, and preserves the draft", async () => {
  let resolve!: (accepted: boolean) => void
  const pending = new Promise<boolean>((done) => {
    resolve = done
  })
  const steer = vi.fn().mockReturnValue(pending),
    remove = vi.fn()
  const props = { supportsActiveSteer: true, onSteerQueued: steer, onRemoveQueued: remove }
  const view = render(composer(props))
  const action = screen.getAllByRole("button", { name: "Steer now" })[0]
  if (!action) throw new Error("Missing queued steering action.")
  await userEvent.click(action)
  expect(steer).toHaveBeenCalledWith("first")
  expect(action.getAttribute("aria-busy")).toBe("true")
  view.rerender(composer({ ...props, steeringQueuedId: "first" }))
  expect(
    screen
      .getAllByRole("button", { name: "Steer now" })
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true)
  const removals = screen.getAllByRole("button", { name: "Remove queued message" })
  expect(removals[0]?.hasAttribute("disabled")).toBe(true)
  expect(removals[1]?.hasAttribute("disabled")).toBe(false)
  expect(screen.getByText("First queued")).toBeTruthy()
  expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
    "Unsent composer text",
  )
  resolve(false)
  view.rerender(composer(props))
  await waitFor(() => expect(action.hasAttribute("disabled")).toBe(false))
  expect(screen.getByText("First queued")).toBeTruthy()
  expect(remove).not.toHaveBeenCalled()
})
