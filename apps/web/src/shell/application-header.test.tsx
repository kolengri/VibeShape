import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { act, cleanup, render } from "@testing-library/react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { ApplicationChromeProvider, ApplicationHeader } from "./application-header"

afterEach(() => {
  cleanup()
  delete window.vibeshapeDesktop
})

it("retains window fullscreen state when project-owned headers remount", () => {
  let update: ((fullScreen: boolean) => void) | undefined
  const unsubscribe = vi.fn()
  const subscribe = vi.fn((listener: (fullScreen: boolean) => void) => {
    update = listener
    return unsubscribe
  })
  window.vibeshapeDesktop = {
    protocolVersion: 1,
    platform: "darwin",
    windowChrome: "unified",
    getMcpSetup: async () => {
      throw new Error("Not used")
    },
    onCommand: () => () => {},
    updateCommandState: async () => {},
    editText: async () => {},
    onFullScreenChange: subscribe,
  }
  const view = (project: string) => (
    <ApplicationChromeProvider>
      <ApplicationHeader key={project}>{project}</ApplicationHeader>
    </ApplicationChromeProvider>
  )
  const rendered = render(view("first"))
  act(() => update?.(true))
  rendered.rerender(view("second"))
  expect(rendered.container.querySelector("header")?.getAttribute("data-full-screen")).toBe("true")
  expect(subscribe).toHaveBeenCalledTimes(1)
  act(() => update?.(false))
  expect(rendered.container.querySelector("header")?.getAttribute("data-full-screen")).toBe("false")
  rendered.unmount()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})
