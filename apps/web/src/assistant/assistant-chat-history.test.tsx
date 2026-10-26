import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { AssistantChatHistory } from "./assistant-chat-history"

afterEach(cleanup)

it("serializes conversation switches and releases every history action after a failed switch", async () => {
  let reject = (_error: Error) => {}
  const onOpen = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail
      }),
  )
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <AssistantChatHistory
        chats={[
          { id: "first", title: "Removable lid", updatedAt: 2 },
          { id: "second", title: "Mounting holes", updatedAt: 1 },
        ]}
        disabled={false}
        onOpen={onOpen}
      />
    </I18nProvider>,
  )
  const first = screen.getByRole("button", { name: "Removable lid" })
  const second = screen.getByRole("button", { name: "Mounting holes" })
  fireEvent.click(first)
  fireEvent.click(second)
  expect(onOpen).toHaveBeenCalledTimes(1)
  expect(first.hasAttribute("disabled")).toBe(true)
  expect(second.hasAttribute("disabled")).toBe(true)
  await act(async () => reject(new Error("Storage is unavailable")))
  await waitFor(() => expect(second.hasAttribute("disabled")).toBe(false))
  expect(first.hasAttribute("disabled")).toBe(false)
  fireEvent.click(second)
  expect(onOpen).toHaveBeenLastCalledWith("second")
  expect(onOpen).toHaveBeenCalledTimes(2)
  await act(async () => reject(new Error("Storage is still unavailable")))
})
