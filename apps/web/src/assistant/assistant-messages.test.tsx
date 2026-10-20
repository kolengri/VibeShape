import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { AssistantMessages } from "./assistant-messages"
import type { ChatMessage } from "./chat-history"

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

function view(messages: readonly ChatMessage[]) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <AssistantMessages messages={messages} />
    </I18nProvider>
  )
}

function transcript(messages: readonly ChatMessage[]) {
  return render(view(messages))
}

describe("assistant tool messages", () => {
  it.each(["", "  \n\t ", "{}", " { } ", "[]", "null", '"  "'])(
    "keeps empty tool output noninteractive (%j)",
    (text) => {
      const { container } = transcript([
        {
          id: "tool",
          role: "tool",
          text,
          tool: { title: "mcp.vs_a7248d83d6f45b80.create_cylinder", status: "completed" },
        },
      ])
      expect(screen.getByText("Create cylinder")).toBeTruthy()
      expect(screen.getByText("Completed")).toBeTruthy()
      expect(container.querySelector("details, summary, button, svg")).toBeNull()
      expect(screen.queryByRole("region", { name: "Tool details" })).toBeNull()
    },
  )

  it("keeps real tool output collapsed and exposes its technical identity when opened", async () => {
    const identity = "mcp.vs_a7248d83d6f45b80.draft_body_measurements"
    transcript([
      {
        id: "measure",
        role: "tool",
        text: "Volume: 240 mm³",
        tool: { title: identity, status: "completed" },
      },
    ])
    const heading = screen.getByText("Measure draft body")
    const details = heading.closest("details")
    expect(details?.open).toBe(false)
    expect(details?.querySelector("summary")?.textContent).not.toContain("vs_a7248d83d6f45b80")
    await userEvent.click(heading)
    expect(details?.open).toBe(true)
    const output = screen.getByRole("region", { name: "Tool details" })
    expect(within(output).getByText(identity)).toBeTruthy()
    expect(
      within(screen.getByRole("region", { name: "Output" })).getByText("Volume: 240 mm³"),
    ).toBeTruthy()
    expect(within(output).getByText(identity).closest("details")?.open).toBe(false)
  })

  it("explains draft work and labels parameters and failed results before raw JSON", async () => {
    transcript([
      {
        id: "cylinder",
        role: "tool",
        text: JSON.stringify({
          command: "create_cylinder",
          arguments: { radiusMm: 10, heightMm: 20 },
          result: { error: "geometry-invalid", message: "Cylinder geometry could not be built." },
        }),
        tool: { title: "mcp.vs_123.create_cylinder", status: "failed" },
      },
    ])
    await userEvent.click(screen.getByText("Create cylinder"))
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(screen.getByText("Add a cylinder to an unsaved CAD draft.")).toBeTruthy()
    const parameters = screen.getByRole("region", { name: "Parameters" })
    expect(within(parameters).getByText("Radius Mm")).toBeTruthy()
    expect(within(parameters).getByText("10")).toBeTruthy()
    expect(within(parameters).getByText("Height Mm")).toBeTruthy()
    const result = screen.getByRole("region", { name: "Result" })
    expect(within(result).getByText("geometry-invalid")).toBeTruthy()
    expect(within(result).getByText("Cylinder geometry could not be built.")).toBeTruthy()
    const technical = screen.getByText("Technical details").closest("details")
    expect(technical?.open).toBe(false)
    await userEvent.click(screen.getByText("Technical details"))
    expect(technical?.open).toBe(true)
    expect(technical?.textContent).toContain('"radiusMm":10')
  })

  it("shows every reported native JSON field without mistaking a result field for an API envelope", async () => {
    transcript([
      {
        id: "native",
        role: "tool",
        text: JSON.stringify({
          result: { volumeMm3: 240 },
          error: "One body could not be measured.",
        }),
        tool: { title: "draft_body_measurements", status: "failed" },
      },
    ])
    await userEvent.click(screen.getByText("Measure draft body"))
    const output = screen.getByRole("region", { name: "Output" })
    expect(within(output).getByText("Volume Mm3")).toBeTruthy()
    expect(within(output).getByText("240")).toBeTruthy()
    expect(within(output).getByText("One body could not be measured.")).toBeTruthy()
  })

  it.each([
    ["create_union", "Union bodies"],
    ["mcp__vibeshape__preview_draft", "Preview draft"],
    ["mcp.other_provider.lookup_weather", "Lookup weather"],
    ["mcp.other_provider.nested.lookup_weather", "Lookup weather"],
    ["mcp.other_provider.ListTools", "List tools"],
    ["inspectDraftBody", "Inspect draft body"],
    ["Run tests for create_cylinder", "Run tests for create_cylinder"],
    ["Preview draft (exact)", "Preview draft (exact)"],
    ["", "Tool"],
  ])("renders %s as %s without changing free-text titles", (title, expected) => {
    transcript([{ id: "tool", role: "tool", text: "", tool: { title } }])
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it("follows updates only while pinned and resumes after returning to the bottom", () => {
    const message: ChatMessage = { id: "reply", role: "assistant", text: "First" }
    const { rerender } = transcript([message])
    const log = screen.getByRole("log")
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
    })
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    log.scrollTop = 600
    fireEvent.scroll(log)
    rerender(view([{ ...message, text: "First update" }]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2)

    log.scrollTop = 100
    fireEvent.scroll(log)
    rerender(view([{ ...message, text: "Reading older messages" }]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
    expect(log.scrollTop).toBe(100)

    log.scrollTop = 560
    fireEvent.scroll(log)
    rerender(view([{ ...message, text: "Near the bottom again" }]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(3)
  })

  it("does not jump to streaming updates after expanded tool content moves the bottom away", () => {
    const tool: ChatMessage = {
      id: "tool",
      role: "tool",
      text: "A long detailed report",
      tool: { title: "preview_draft", status: "in_progress" },
    }
    const { rerender } = transcript([tool])
    const log = screen.getByRole("log")
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
    })
    log.scrollTop = 600
    fireEvent.scroll(log)
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1_400 })
    const details = screen.getByText("Preview draft").closest("details")
    expect(details).toBeTruthy()
    if (details) {
      details.open = true
      fireEvent(details, new Event("toggle", { bubbles: true }))
    }
    rerender(view([{ ...tool, text: "An updated long detailed report" }]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(log.scrollTop).toBe(600)
  })

  it("keeps the transcript still while reading earlier lines within tool output", async () => {
    const tool: ChatMessage = {
      id: "tool",
      role: "tool",
      text: "A detailed report",
      tool: { title: "preview_draft", status: "in_progress" },
    }
    const { rerender } = transcript([tool])
    await userEvent.click(screen.getByText("Preview draft"))
    const log = screen.getByRole("log")
    const output = screen.getByRole("region", { name: "Tool details" })
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
    })
    Object.defineProperties(output, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 700 },
    })
    log.scrollTop = 600
    fireEvent.scroll(log)
    output.scrollTop = 100
    fireEvent.scroll(output)
    const technical = screen.getByText("Technical details").closest("details")
    if (technical) {
      technical.open = true
      fireEvent(technical, new Event("toggle", { bubbles: true }))
    }
    rerender(view([{ ...tool, text: "An updated detailed report" }]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(log.scrollTop).toBe(600)
    expect(output.scrollTop).toBe(100)
    output.scrollTop = 500
    fireEvent.scroll(output)
    rerender(view([{ ...tool, text: "At the end of the report" }]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it.each([600, 100])(
    "restores following after closing tool output only at the transcript bottom (scrollTop %i)",
    (scrollTop) => {
      const tool: ChatMessage = {
        id: "tool",
        role: "tool",
        text: "A detailed report",
        tool: { title: "preview_draft", status: "in_progress" },
      }
      const { rerender } = transcript([tool])
      const log = screen.getByRole("log")
      const details = screen.getByText("Preview draft").closest("details")
      const output = screen.getByRole("region", { name: "Tool details", hidden: true })
      const technical = screen.getByText("Technical details").closest("details")
      expect(details).toBeTruthy()
      expect(technical).toBeTruthy()
      if (!details || !technical) throw new Error("Tool disclosures must exist.")
      Object.defineProperties(log, {
        clientHeight: { configurable: true, value: 300 },
        scrollHeight: { configurable: true, value: 900 },
      })
      Object.defineProperties(output, {
        clientHeight: { configurable: true, value: 200 },
        scrollHeight: { configurable: true, value: 700 },
      })
      log.scrollTop = scrollTop
      fireEvent.scroll(log)
      details.open = true
      fireEvent(details, new Event("toggle"))
      output.scrollTop = 100
      fireEvent.scroll(output)
      technical.open = false
      fireEvent(technical, new Event("toggle"))
      rerender(view([{ ...tool, text: "Reading tool output" }]))
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
      expect(output.scrollTop).toBe(100)

      details.open = false
      fireEvent(details, new Event("toggle"))
      rerender(view([{ ...tool, text: "The next assistant update" }]))
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(scrollTop === 600 ? 2 : 1)
      expect(log.scrollTop).toBe(scrollTop)
    },
  )
})
