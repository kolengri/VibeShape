// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "./button"

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

afterEach(cleanup)

describe("Button", () => {
  it("ignores the second activation in a pointer double-click", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(<Button onClick={onClick}>Create sketch</Button>)

    await user.dblClick(screen.getByRole("button", { name: "Create sketch" }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("disables itself and shows a spinner while an async click is pending", async () => {
    const user = userEvent.setup()
    const operation = deferred<void>()
    const onClick = vi.fn(() => operation.promise)

    render(<Button onClick={onClick}>Export project</Button>)
    const button = screen.getByRole("button", { name: "Export project" }) as HTMLButtonElement

    await user.click(button)

    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull()

    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    operation.resolve()

    await waitFor(() => {
      expect(button.disabled).toBe(false)
      expect(button.getAttribute("aria-busy")).toBeNull()
    })
  })

  it("releases the pending state when an async click rejects", async () => {
    const user = userEvent.setup()
    const operation = deferred<void>()

    render(<Button onClick={() => operation.promise}>Run print check</Button>)
    const button = screen.getByRole("button", { name: "Run print check" }) as HTMLButtonElement

    await user.click(button)
    operation.reject(new Error("Print check failed"))

    await waitFor(() => expect(button.disabled).toBe(false))
  })

  it("uses accessible disabled semantics for a slotted child", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <Button asChild isLoading onClick={onClick}>
        <a href="/projects">Open projects</a>
      </Button>,
    )
    const link = screen.getByRole("link", { name: "Open projects" })

    expect(link.getAttribute("aria-disabled")).toBe("true")
    expect(link.getAttribute("aria-busy")).toBe("true")

    await user.click(link)
    expect(onClick).not.toHaveBeenCalled()
  })
})
