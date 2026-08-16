// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { EditorSessionProvider, useEditorSession } from "./editor-session-provider"

afterEach(cleanup)

function SessionProbe() {
  const commandPaletteOpen = useEditorSession((state) => state.commandPaletteOpen)
  const setCommandPaletteOpen = useEditorSession((state) => state.actions.setCommandPaletteOpen)
  return (
    <>
      <output aria-label="Command palette state">{commandPaletteOpen ? "open" : "closed"}</output>
      <button type="button" onClick={() => setCommandPaletteOpen(true)}>
        Open palette
      </button>
    </>
  )
}

describe("EditorSessionProvider", () => {
  it("keeps early interaction through hydration and resets on a real document change", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <EditorSessionProvider documentId={null}>
        <SessionProbe />
      </EditorSessionProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Open palette" }))
    expect(screen.getByLabelText("Command palette state").textContent).toBe("open")

    rerender(
      <EditorSessionProvider documentId="document-a">
        <SessionProbe />
      </EditorSessionProvider>,
    )

    expect(screen.getByLabelText("Command palette state").textContent).toBe("open")

    rerender(
      <EditorSessionProvider documentId="document-b">
        <SessionProbe />
      </EditorSessionProvider>,
    )

    expect(screen.getByLabelText("Command palette state").textContent).toBe("closed")
  })
})
