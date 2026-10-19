import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test"
import { reportEditorLoadFailure } from "./editor-load-error"

const diagnostic = spyOn(console, "error").mockImplementation(() => {})
afterEach(() => diagnostic.mockClear())
afterAll(() => diagnostic.mockRestore())

describe("native editor load failure copy", () => {
  for (const error of [
    new Error("net::ERR_CONNECTION_REFUSED at http://private.invalid"),
    new TypeError("Internal diagnostic"),
    "untyped failure",
  ]) {
    it("uses catalog copy without exposing runtime diagnostics in a packaged app", () => {
      const shown: { title: string; content: string }[] = []
      reportEditorLoadFailure(error, true, (title, content) => shown.push({ title, content }))
      expect(shown).toEqual([
        {
          title: "VibeShape could not open the editor",
          content:
            "The editor could not be loaded. Quit VibeShape and open it again. If the problem continues, reinstall the app.",
        },
      ])
      expect(diagnostic).not.toHaveBeenCalled()
    })
  }
  it("retains diagnostics only in the development console", () => {
    const error = new Error("Development diagnostic")
    let content = ""
    reportEditorLoadFailure(error, false, (_title, message) => {
      content = message
    })
    expect(diagnostic).toHaveBeenCalledWith("The desktop editor failed to load:", error)
    expect(content).not.toContain(error.message)
  })
})
