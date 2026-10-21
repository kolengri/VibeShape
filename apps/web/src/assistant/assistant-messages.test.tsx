import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { documentIdSchema, featureIdSchema, sketchIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ReactNode } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { AssistantMessages } from "./assistant-messages"
import type { AssistantToolHighlight } from "./assistant-tool-highlight"
import type { ChatMessage } from "./chat-history"

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

function view(
  messages: readonly ChatMessage[],
  onHighlight?: AssistantToolHighlight,
  footer?: ReactNode,
) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <AssistantMessages messages={messages} onHighlight={onHighlight} footer={footer} />
    </I18nProvider>
  )
}

function transcript(messages: readonly ChatMessage[]) {
  return render(view(messages))
}

function toolMessage(
  id: string,
  title = "Read agent skill",
  status = "completed",
  text = "",
): ChatMessage {
  return { id, role: "tool", text, tool: { title, status } }
}

describe("assistant Markdown", () => {
  it("renders model prose, code, lists, and tables while keeping user text literal", () => {
    transcript([
      { id: "user", role: "user", text: "Keep **these markers** in my message." },
      {
        id: "reply",
        role: "assistant",
        text: [
          "## Updated model",
          "Wall thickness is **2.0 mm** with *flexible* sides and `wallThickness` intent.",
          "- Preserve the lid\n- Preserve the neck",
          "1. Inspect\n2. Confirm",
          "> Print strength is unverified.",
          "```ts\nconst wall = 2.0\n```",
          "| Dimension | Value |\n| --- | --- |\n| Wall | 2.0 mm |",
        ].join("\n\n"),
      },
    ])
    expect(screen.getByRole("heading", { name: "Updated model", level: 2 })).toBeTruthy()
    expect(screen.getByText("2.0 mm", { selector: "strong" })).toBeTruthy()
    expect(screen.getByText("flexible", { selector: "em" })).toBeTruthy()
    expect(screen.getByText("wallThickness", { selector: "code" })).toBeTruthy()
    expect(document.querySelectorAll("ul > li")).toHaveLength(2)
    expect(document.querySelectorAll("ol > li")).toHaveLength(2)
    expect(screen.getByText("Print strength is unverified.").closest("blockquote")).toBeTruthy()
    expect(document.querySelector("pre > code")?.textContent).toBe("const wall = 2.0\n")
    expect(within(screen.getByRole("table")).getByRole("cell", { name: "2.0 mm" })).toBeTruthy()
    expect(
      screen.getByText("Keep **these markers** in my message.").querySelector("strong"),
    ).toBeNull()
  })

  it("ignores raw HTML, blocks unsafe links, and does not load model-authored images", () => {
    transcript([
      {
        id: "reply",
        role: "assistant",
        text: [
          "[Reference](https://example.com/model) [Unsafe](javascript:alert%281%29)",
          "[Local file](file:///private/model.step) ![Model illustration](https://example.com/track.png)",
          '<img src="https://example.com/raw.png" onerror="alert(1)">',
          "<script>alert(1)</script>",
        ].join("\n\n"),
      },
    ])
    const reference = screen.getByRole("link", { name: "Reference" })
    expect(reference.getAttribute("href")).toBe("https://example.com/model")
    expect(reference.getAttribute("target")).toBe("_blank")
    expect(reference.getAttribute("rel")).toBe("noopener noreferrer")
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Local file" })).toBeNull()
    expect(screen.getByText("Model illustration")).toBeTruthy()
    expect(document.querySelector("script, img")).toBeNull()
  })

  it("updates streamed Markdown without moving a reader away from earlier messages", () => {
    const rendered = transcript([{ id: "reply", role: "assistant", text: "Wall **2.0" }])
    const log = screen.getByRole("log")
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    })
    log.scrollTop = 40
    fireEvent.scroll(log)
    const scrollCalls = vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls.length
    rendered.rerender(view([{ id: "reply", role: "assistant", text: "Wall **2.0 mm**." }]))
    expect(screen.getByText("2.0 mm", { selector: "strong" })).toBeTruthy()
    expect(log.scrollTop).toBe(40)
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls).toHaveLength(scrollCalls)
  })

  it("keeps footnote references, labels, and return links inside their own reply", () => {
    transcript([
      { id: "first", role: "assistant", text: "First answer[^1].\n\n[^1]: First explanation." },
      { id: "second", role: "assistant", text: "Second answer[^1].\n\n[^1]: Second explanation." },
    ])
    const log = screen.getByRole("log")
    const ids = [...log.querySelectorAll("[id]")].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const article of log.querySelectorAll("article")) {
      const reference = article.querySelector("a[data-footnote-ref]")
      const back = article.querySelector("a[data-footnote-backref]")
      const label = document.getElementById(reference?.getAttribute("aria-describedby") ?? "")
      const note = document.getElementById(reference?.getAttribute("href")?.slice(1) ?? "")
      expect(article.contains(label)).toBe(true)
      expect(label?.textContent).toBe("Footnotes")
      expect(article.contains(note)).toBe(true)
      expect(note?.contains(back)).toBe(true)
      expect(back?.getAttribute("href")).toBe(`#${reference?.id}`)
      expect(reference?.hasAttribute("target")).toBe(false)
      expect(back?.hasAttribute("target")).toBe(false)
    }
  })
})

describe("assistant tool messages", () => {
  it.each([
    ["retained native progress", "Preparing preview"],
    [
      "API parameters and empty failure",
      JSON.stringify({
        command: "call_cad_tool",
        arguments: { name: "preview_draft" },
        result: { ok: false },
      }),
    ],
  ])("explains missing failure evidence alongside %s", async (_label, text) => {
    const message = toolMessage("failed", "preview_draft", "failed", text)
    transcript([{ ...message, tool: { ...message.tool, hasFailureDetails: false } }])
    await userEvent.click(screen.getByText("Preview draft"))
    expect(
      screen.getByText("The agent did not provide an error message for this call."),
    ).toBeTruthy()
    expect(screen.getByText("Technical details")).toBeTruthy()
  })

  it("keeps failure evidence distinct for individual calls inside a group", async () => {
    transcript([
      {
        ...toolMessage("missing", "preview_draft", "failed", "Preparing preview"),
        tool: { title: "preview_draft", status: "failed", hasFailureDetails: false },
      },
      {
        ...toolMessage(
          "reported",
          "preview_draft",
          "failed",
          "The preview contains an open shell.",
        ),
        tool: { title: "preview_draft", status: "failed", hasFailureDetails: true },
      },
    ])
    await userEvent.click(screen.getByText("Preview draft"))
    const calls = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem")
    const missing = calls[0],
      reported = calls[1]
    if (!missing || !reported) throw new Error("Both failed calls must remain inspectable.")
    expect(
      within(missing).getByText("The agent did not provide an error message for this call."),
    ).toBeTruthy()
    expect(
      within(reported).queryByText("The agent did not provide an error message for this call."),
    ).toBeNull()
    expect(
      within(reported).getAllByText("The preview contains an open shell.").length,
    ).toBeGreaterThan(0)
  })

  it("makes missing failure evidence explicit without adding an empty disclosure", () => {
    transcript([toolMessage("failed", "preview_draft", "failed")])
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(
      screen.getByText("The agent did not provide an error message for this call."),
    ).toBeTruthy()
    expect(document.querySelector("details")).toBeNull()
  })

  it("highlights the grouped union and each expanded call independently without selecting", async () => {
    const projectId = documentIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3300")
    const firstId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3301")
    const secondId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3302")
    const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3303")
    const targets = { projectId, featureIds: [firstId], sketchIds: [sketchId] }
    const messages: ChatMessage[] = [
      {
        ...toolMessage("one", "create_cylinder", "completed", "First body"),
        tool: { title: "create_cylinder", status: "completed", targets },
      },
      {
        ...toolMessage("two", "create_cylinder", "completed", "Second body"),
        tool: {
          title: "create_cylinder",
          status: "completed",
          targets: { ...targets, featureIds: [secondId, firstId] },
        },
      },
    ]
    const onHighlight = vi.fn<AssistantToolHighlight>()
    const rendered = render(view(messages, onHighlight))
    const summary = screen.getByText("Create cylinder").closest("summary")
    if (!summary) throw new Error("Grouped actions need a summary.")
    fireEvent.pointerEnter(summary)
    const groupOwner = onHighlight.mock.calls.at(-1)?.[0]
    expect(onHighlight.mock.calls.at(-1)?.[1]).toEqual({
      ...targets,
      featureIds: [firstId, secondId],
    })
    fireEvent.pointerLeave(summary)
    expect(onHighlight).toHaveBeenLastCalledWith(groupOwner, null)
    await userEvent.click(summary)
    const calls = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem")
    const firstCall = calls[0]
    if (!firstCall) throw new Error("The first call must remain inspectable.")
    fireEvent.focus(firstCall)
    const callOwner = onHighlight.mock.calls.at(-1)?.[0]
    expect(callOwner).not.toBe(groupOwner)
    expect(onHighlight.mock.calls.at(-1)?.[1]).toEqual(targets)
    fireEvent.pointerEnter(firstCall)
    fireEvent.blur(firstCall)
    expect(onHighlight.mock.calls.at(-1)?.[1]).toEqual(targets)
    fireEvent.pointerLeave(firstCall)
    expect(onHighlight).toHaveBeenLastCalledWith(callOwner, null)
    fireEvent.focus(firstCall)
    rendered.unmount()
    expect(
      onHighlight.mock.calls.some(([owner, value]) => owner === callOwner && value === null),
    ).toBe(true)
  })

  it("does not infer highlights from readable titles or mixed-project metadata", () => {
    const projectId = documentIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3300")
    const otherProject = documentIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3399")
    const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3301")
    const onHighlight = vi.fn<AssistantToolHighlight>()
    render(
      view(
        [
          toolMessage("old", "create_boolean"),
          ...[projectId, otherProject].map(
            (id, index): ChatMessage => ({
              ...toolMessage(`mixed-${index}`, "create_cylinder"),
              tool: {
                title: "create_cylinder",
                status: "completed",
                targets: { projectId: id, featureIds: [featureId], sketchIds: [] },
              },
            }),
          ),
        ],
        onHighlight,
      ),
    )
    expect(document.querySelector("[tabindex]")).toBeNull()
    fireEvent.pointerEnter(screen.getByText("Create cylinder").parentElement as HTMLElement)
    expect(onHighlight).not.toHaveBeenCalled()
  })
  it("compresses consecutive repeated actions into one row with a right-hand count", () => {
    const { container } = transcript([
      ...Array.from({ length: 7 }, (_, index) => toolMessage(`skill-${index}`)),
      toolMessage("list", "List mcp resources"),
      toolMessage("read-1", "Read mcp resource"),
      toolMessage("read-2", "Read mcp resource"),
      toolMessage("tree", "Model tree"),
    ])
    expect(screen.getAllByText("Read agent skill")).toHaveLength(1)
    expect(screen.getAllByText("Read mcp resource")).toHaveLength(1)
    expect(screen.getAllByText("Completed")).toHaveLength(4)
    const count = screen.getByText("7 tool calls").parentElement
    expect(count?.querySelector('[aria-hidden="true"]')?.textContent).toBe("7")
    expect(count?.parentElement?.lastElementChild).toBe(count)
    expect(screen.getByText("2 tool calls")).toBeTruthy()
    expect(container.querySelector("details, summary, button, svg")).toBeNull()
  })

  it("preserves transcript order and keeps different statuses and unnamed tools separate", () => {
    const { container } = transcript([
      toolMessage("first"),
      { id: "reply", role: "assistant", text: "Checking the next file" },
      toolMessage("second"),
      toolMessage("third"),
      toolMessage("failed", "Read agent skill", "failed"),
      toolMessage("running", "Read agent skill", "in_progress"),
      toolMessage("other", "Model tree"),
      toolMessage("last"),
      toolMessage("unnamed-1", ""),
      toolMessage("unnamed-2", ""),
    ])
    expect(screen.getAllByText("Read agent skill")).toHaveLength(5)
    expect(screen.getByText("2 tool calls")).toBeTruthy()
    expect(screen.getAllByText("Tool")).toHaveLength(2)
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(screen.getByText("Running")).toBeTruthy()
    const log = screen.getByRole("log")
    expect(log.children[0]?.textContent).toBe("Read agent skillCompleted")
    expect(log.children[1]?.textContent).toBe("AssistantChecking the next file")
    expect(log.children[2]?.textContent).toBe("Read agent skillCompleted22 tool calls")
    expect(container.querySelector("details")).toBeNull()
  })

  it("retains every call's output inside one collapsed group", async () => {
    transcript([
      toolMessage("one", "create_cylinder", "completed", "First cylinder: 10 mm"),
      toolMessage("two", "create_cylinder", "completed", "Second cylinder: 20 mm"),
      toolMessage("empty", "create_cylinder", "completed", "{}"),
    ])
    const heading = screen.getByText("Create cylinder")
    const group = heading.closest("details")
    expect(group?.open).toBe(false)
    expect(screen.getByText("3 tool calls")).toBeTruthy()
    await userEvent.click(heading)
    expect(group?.open).toBe(true)
    const calls = within(screen.getByRole("list", { name: "Tool calls" })).getAllByRole("listitem")
    expect(calls).toHaveLength(3)
    expect(
      calls.map(
        (call) =>
          within(call).queryByRole("region", { name: "Output" })?.textContent ?? call.textContent,
      ),
    ).toEqual(["OutputFirst cylinder: 10 mm", "OutputSecond cylinder: 20 mm", "Call 3None"])
    expect(screen.getAllByText("Technical details")).toHaveLength(2)
  })

  it("updates a repeated-action count without closing the group or moving a reader's scroll", async () => {
    const messages = [
      toolMessage("one", "read_mcp_resource", "completed", "First resource"),
      toolMessage("two", "read_mcp_resource", "completed", "Second resource"),
    ]
    const { rerender } = transcript(messages)
    await userEvent.click(screen.getByText("Read mcp resource"))
    const group = screen.getByText("Read mcp resource").closest("details")
    const log = screen.getByRole("log")
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
    })
    log.scrollTop = 100
    fireEvent.scroll(log)
    rerender(
      view([...messages, toolMessage("three", "read_mcp_resource", "completed", "Third resource")]),
    )
    expect(screen.getByText("Read mcp resource").closest("details")).toBe(group)
    expect(group?.open).toBe(true)
    expect(screen.getByText("3 tool calls")).toBeTruthy()
    expect(
      screen.getAllByRole("region", { name: "Output" }).map((output) => output.textContent),
    ).toEqual(["OutputFirst resource", "OutputSecond resource", "OutputThird resource"])
    expect(log.scrollTop).toBe(100)
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

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

  it.each([600, 560, 100])(
    "preserves scrollTop %i across cloned transcripts and footer/display changes, then follows real content only when pinned",
    (scrollTop) => {
      const message: ChatMessage = {
        id: "reply",
        role: "assistant",
        text: "A saved batch.",
        attachments: [{ id: "file", name: "Part.step" }],
      }
      const rendered = render(
        view([message], undefined, <button type="button">View before</button>),
      )
      const log = screen.getByRole("log")
      Object.defineProperties(log, {
        clientHeight: { configurable: true, value: 300 },
        scrollHeight: { configurable: true, value: 900 },
      })
      log.scrollTop = scrollTop
      fireEvent.scroll(log)
      const initial = vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls.length
      for (const footer of [
        null,
        <button key="current" type="button">
          View current
        </button>,
        <button key="changes" type="button">
          Changes
        </button>,
        <button key="result" type="button">
          Result
        </button>,
      ]) {
        rendered.rerender(view([structuredClone(message)], undefined, footer))
        expect(log.scrollTop).toBe(scrollTop)
        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(initial)
      }
      rendered.rerender(view([{ ...message, text: "The next streamed reply." }]))
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(
        initial + (scrollTop >= 552 ? 1 : 0),
      )
    },
  )

  it("follows new messages and changed attachments or tool status without following highlight metadata", () => {
    const tool: ChatMessage = {
      id: "tool",
      role: "tool",
      text: "",
      tool: { title: "create_box", status: "in_progress" },
    }
    const rendered = render(view([tool]))
    rendered.rerender(view([structuredClone(tool)]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    rendered.rerender(view([{ ...tool, tool: { ...tool.tool, status: "completed" } }]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
    const reply: ChatMessage = { id: "reply", role: "assistant", text: "Ready." }
    rendered.rerender(view([tool, reply]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(3)
    rendered.rerender(view([tool, { ...reply, attachments: [{ id: "file", name: "Part.step" }] }]))
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(4)
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
