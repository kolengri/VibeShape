import { setDomUrl } from "../../../../tests/unit/support/dom"

setDomUrl("http://localhost:5291/projects/example?tab=cad")

import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { FaqDialog } from "./faq-dialog"

const endpoint = "https://relay.example/mcp"
afterEach(() => {
  cleanup()
  delete window.vibeshapeDesktop
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  document.querySelector('meta[name="vibeshape-local-automation"]')?.remove()
})
function setup(url?: string) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <FaqDialog endpoint={url} />
    </I18nProvider>,
  )
}
describe("FAQ connection guide", () => {
  it("shows the app-owned stdio setup in the production Mac app without remote or development HTTP instructions", async () => {
    vi.stubEnv("DEV", false)
    const configuration = {
      protocolVersion: 1 as const,
      mcpServers: {
        vibeshape: {
          command: "/Applications/VibeShape.app/Contents/MacOS/VibeShape",
          args: ["/app/mcp.cjs", "--descriptor", "/private/profile/desktop-mcp.json"] as [
            string,
            "--descriptor",
            string,
          ],
          env: { ELECTRON_RUN_AS_NODE: "1" as const },
        },
      },
    }
    window.vibeshapeDesktop = {
      protocolVersion: 1,
      platform: "darwin",
      windowChrome: "unified",
      getMcpSetup: async () => configuration,
      onCommand: () => () => {},
      updateCommandState: async () => {},
      editText: async () => {},
    }
    const user = userEvent.setup()
    setup(endpoint)
    await user.click(screen.getByRole("button", { name: "FAQ" }))
    const textbox = await screen.findByRole("textbox", { name: "MCP client configuration" })
    await waitFor(() => expect((textbox as HTMLTextAreaElement).value).toContain("mcp.cjs"))
    expect((textbox as HTMLTextAreaElement).value).not.toContain(endpoint)
    expect(screen.queryByRole("textbox", { name: "MCP server URL" })).toBeNull()
    expect(screen.queryByRole("textbox", { name: "AI setup prompt" })).toBeNull()
  })
  it("copies the current development origin and local setup prompt instead of remote OAuth instructions", async () => {
    vi.stubEnv("DEV", true)
    const marker = document.createElement("meta")
    marker.name = "vibeshape-local-automation"
    marker.content = "1"
    document.head.append(marker)
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
    setup(endpoint)
    await user.click(screen.getByRole("button", { name: "FAQ" }))
    const localEndpoint = "http://localhost:5291/mcp"
    expect(
      (screen.getByRole("textbox", { name: "MCP server URL" }) as HTMLInputElement).value,
    ).toBe(localEndpoint)
    const prompt = (screen.getByRole("textbox", { name: "AI setup prompt" }) as HTMLTextAreaElement)
      .value
    expect(prompt).toContain(localEndpoint)
    expect(prompt).not.toContain(endpoint)
    expect(prompt).toContain("Streamable HTTP with no authentication")
    expect(prompt).toContain("vibeshape://session")
    expect(prompt).toContain("model_info")
    expect(prompt).toContain("wait for my manual Apply")
    expect(prompt).toContain("Never replay a write automatically")
    expect(screen.queryByText(/create a pairing code/)).toBeNull()
    await user.click(screen.getByRole("button", { name: "Copy AI setup prompt" }))
    await waitFor(() => expect(copy).toHaveBeenCalledWith(prompt))
    await user.click(screen.getByRole("button", { name: "Copy MCP server URL" }))
    await waitFor(() => expect(copy).toHaveBeenCalledWith(localEndpoint))
  })

  it("does not infer an HTTP endpoint from a production stdio editor marker", async () => {
    vi.stubEnv("DEV", false)
    const marker = document.createElement("meta")
    marker.name = "vibeshape-local-automation"
    marker.content = "1"
    document.head.append(marker)
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole("button", { name: "FAQ" }))
    expect(screen.queryByRole("textbox", { name: "MCP server URL" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Copy AI setup prompt" })).toBeNull()
  })

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
