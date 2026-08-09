// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TextField } from "@vibeshape/ui/components/text-field"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SlicerBridgeConnectionPanel } from "./slicer-bridge-connection-panel"

afterEach(cleanup)

describe("SlicerBridgeConnectionPanel", () => {
  it("composes the uncontrolled field primitive without owning its value", async () => {
    const user = userEvent.setup()
    const onDisconnect = vi.fn()
    render(
      <SlicerBridgeConnectionPanel
        connected
        copy={{ connected: "Connected", disconnected: "Not connected", disconnect: "Disconnect" }}
        onDisconnect={onDisconnect}
        tokenField={<TextField label="Pairing token" defaultValue="initial" />}
        saveAction={<button type="submit">Save</button>}
      />,
    )

    const token = screen.getByRole("textbox", { name: "Pairing token" }) as HTMLInputElement
    await user.clear(token)
    await user.type(token, "replacement")
    expect(token.value).toBe("replacement")

    await user.click(screen.getByRole("button", { name: "Disconnect" }))
    expect(onDisconnect).toHaveBeenCalledOnce()
  })
})
