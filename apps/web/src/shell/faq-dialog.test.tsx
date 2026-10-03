// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import { FaqDialog } from "./faq-dialog"

const endpoint = "https://relay.example/mcp"
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function setup(url?: string) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <FaqDialog endpoint={url} />
    </I18nProvider>,
  )
}
describe("FAQ connection guide", () => {
  it("explains pairing and copies the configured endpoint and safety-preserving AI prompt", async () => {
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
    setup(endpoint)
    await user.click(screen.getByRole("button", { name: "FAQ" }))
    expect(screen.getByRole("textbox", { name: "MCP server URL" }).getAttribute("value")).toBe(
      endpoint,
    )
    await user.click(screen.getByRole("button", { name: "Copy MCP server URL" }))
    await waitFor(() => expect(copy).toHaveBeenCalledWith(endpoint))
    const prompt = (screen.getByRole("textbox", { name: "AI setup prompt" }) as HTMLTextAreaElement)
      .value
    expect(prompt).toContain(endpoint)
    expect(prompt).toContain("model_info")
    expect(prompt).toContain("wait for my manual Apply")
    expect(prompt).toContain("Never replay a write automatically")
    await user.click(screen.getByRole("button", { name: "Copy AI setup prompt" }))
    await waitFor(() => expect(copy).toHaveBeenCalledWith(prompt))
    await user.click(screen.getByRole("button", { name: "Save and export" }))
    expect(screen.getByRole("heading", { name: "Save and export" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Close FAQ" }))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "FAQ" }))
  })

  it("releases a rejected clipboard action and provides a manual fallback", async () => {
    const user = userEvent.setup()
    const copy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValueOnce(new Error("Clipboard denied"))
      .mockResolvedValueOnce(undefined)
    setup(endpoint)
    await user.click(screen.getByRole("button", { name: "FAQ" }))
    const button = screen.getByRole("button", { name: "Copy MCP server URL" })
    await user.click(button)
    expect(await screen.findByText(/Clipboard access failed/)).toBeTruthy()
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    await user.click(button)
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(2))
    expect(await screen.findByText("Copied to clipboard.")).toBeTruthy()
  })

  it("does not advertise an endpoint or AI prompt when remote MCP is unconfigured", async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole("button", { name: "FAQ" }))
    expect(screen.getByText(/Remote MCP is not configured/)).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "MCP server URL" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Copy AI setup prompt" })).toBeNull()
  })
})
