// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  SlicerBridgeConnectionForm,
  type SlicerBridgeConnectionFormCopy,
} from "./slicer-bridge-connection-form"

const copy: SlicerBridgeConnectionFormCopy = {
  connected: "Bridge connected",
  disconnected: "Bridge not connected",
  disconnect: "Disconnect",
  disconnectFailed: "Credential could not be removed.",
  formLabel: "Desktop bridge connection",
  tokenLabel: "Pairing token",
  tokenDescription: "Paste the token printed by the bridge.",
  invalidToken: "Enter a valid token.",
  save: "Connect",
  saved: "Bridge credential saved.",
  saveFailed: "Credential could not be saved.",
}

afterEach(cleanup)

describe("SlicerBridgeConnectionForm", () => {
  it("validates through TanStack Form and guards asynchronous double submission", async () => {
    const user = userEvent.setup()
    let resolveSave: (saved: boolean) => void = () => undefined
    const saveResult = new Promise<boolean>((resolve) => {
      resolveSave = resolve
    })
    const onSave = vi.fn(() => saveResult)
    render(
      <SlicerBridgeConnectionForm
        connected={false}
        copy={copy}
        onDisconnect={vi.fn()}
        onSave={onSave}
      />,
    )

    const token = screen.getByLabelText("Pairing token")
    const connect = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)

    await user.type(token, "invalid token")
    await user.tab()
    expect(screen.getByText("Enter a valid token.")).toBeTruthy()
    expect(connect.disabled).toBe(true)

    await user.clear(token)
    await user.type(token, "a".repeat(43))
    expect(connect.disabled).toBe(false)
    await user.dblClick(connect)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith("a".repeat(43))
    expect(connect.disabled).toBe(true)
    expect(connect.getAttribute("aria-busy")).toBe("true")

    resolveSave(true)
    await waitFor(() => expect(screen.getByText("Bridge credential saved.")).toBeTruthy())
    expect((token as HTMLInputElement).value).toBe("")
  })
})
