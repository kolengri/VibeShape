import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { AssistantSnapshot } from "@vibeshape/automation-api/assistant"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { ActivityProvider, useActivityPending } from "@vibeshape/ui/components/activity"
import type { ReactNode } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n, messages } from "../i18n"
import { ApplicationNoticesProvider } from "../shell/application-notices"
import { saveApiPreferences } from "./api-assistant-preferences"
import { ApiAssistantProvider } from "./api-assistant-provider"
import { ApiConfigurationForm } from "./api-configuration-form"
import { AssistantPanel } from "./assistant-panel"
import { readAssistantPreferences, saveAssistantPreferences } from "./assistant-preferences"
import { NativeAgentConfiguration } from "./native-agent-configuration"
import { NativeSessionControls } from "./native-session-controls"

function ActivityReceipt() {
  const pending = useActivityPending()
  return <output aria-label="Global activity">{pending ? "active" : "idle"}</output>
}
function show(children: ReactNode) {
  return render(
    <ActivityProvider>
      <I18nProvider i18n={i18n} initialLocale="en">
        <ApiAssistantProvider>
          {children}
          <ActivityReceipt />
        </ApiAssistantProvider>
      </I18nProvider>
    </ActivityProvider>,
  )
}
async function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" })
  await userEvent.click(screen.getByRole("option", { name: option }))
}
function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("assistant connection settings", () => {
  it("renders each advertised configuration once and keeps the confirmed reasoning value while a change is pending", async () => {
    const pending = deferred()
    const chat = {
      setMode: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setConfigOption: vi.fn().mockReturnValue(pending.promise),
    }
    const snapshot: AssistantSnapshot = {
      projectId: "project",
      sessionToken: "session",
      sessionId: "agent-session",
      status: "ready",
      canResume: false,
      modes: [{ id: "legacy", name: "Legacy mode" }],
      currentModeId: "legacy",
      models: [{ id: "legacy-model", name: "Legacy model" }],
      currentModelId: "legacy-model",
      authMethods: [],
      attachmentCapabilities: { text: false, images: false },
      configOptions: [
        {
          id: "access",
          category: "mode",
          name: "Access",
          currentValue: "read-only",
          options: [{ id: "read-only", name: "Read only" }],
        },
        {
          id: "model",
          category: "model",
          name: "Model",
          currentValue: "small",
          options: [{ id: "small", name: "Small" }],
        },
        {
          id: "opaque-reasoning",
          category: "thought_level",
          name: "Reasoning effort",
          currentValue: "brief",
          options: [
            { id: "brief", name: "Brief" },
            { id: "deep", name: "Deep" },
          ],
        },
      ],
    }
    const view = show(<NativeSessionControls chat={chat} snapshot={snapshot} busy={false} />)
    expect(screen.getAllByRole("combobox")).toHaveLength(3)
    expect(screen.queryByRole("combobox", { name: "Agent mode" })).toBeNull()
    await choose("Reasoning effort", "Deep")
    expect(chat.setConfigOption).toHaveBeenCalledWith("opaque-reasoning", "deep")
    expect(screen.getByRole("combobox", { name: "Reasoning effort" }).textContent).toContain(
      "Brief",
    )
    expect(
      screen.getAllByRole("combobox").every((element) => element.hasAttribute("disabled")),
    ).toBe(true)
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(
      screen.getAllByRole("combobox").every((element) => !element.hasAttribute("disabled")),
    ).toBe(true)
    view.unmount()
    show(
      <NativeSessionControls
        chat={chat}
        snapshot={{
          ...snapshot,
          configOptions: [
            {
              id: "opaque-reasoning",
              name: "Reasoning effort",
              currentValue: "extreme",
              options: [{ id: "extreme", name: "Extreme" }],
            },
          ],
          modes: [],
          models: [],
        }}
        busy={false}
      />,
    )
    expect(screen.getByRole("combobox", { name: "Reasoning effort" }).textContent).toContain(
      "Extreme",
    )
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Reasoning effort" }), { key: "Enter" })
    expect(screen.queryByRole("option", { name: "Deep" })).toBeNull()
  })

  it("selects a known installed-command preset without launching or installing until Connect", async () => {
    const chat = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected={false} />)
    expect(screen.getByRole("button", { name: "Connect agent" }).hasAttribute("disabled")).toBe(
      true,
    )
    await choose("Agent", "Codex")
    expect(chat.connect).not.toHaveBeenCalled()
    expect(screen.getByText("Advanced connection").closest("details")?.open).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Connect agent" }))
    expect(chat.connect).toHaveBeenCalledWith({ command: "codex-acp", args: [] })
    expect(readAssistantPreferences()?.agent).toEqual({ command: "codex-acp", args: [] })
    expect(screen.getByRole("button", { name: "Connect agent" }).hasAttribute("title")).toBe(false)
  })

  it("keeps the saved custom command and argument array when switching presets", async () => {
    const original = { command: "/private/Custom Agent", args: ["--acp", "argument with spaces"] }
    saveAssistantPreferences({ version: 1, agent: original })
    const chat = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected={false} />)
    expect(
      (screen.getByRole("textbox", { name: "ACP agent executable" }) as HTMLInputElement).value,
    ).toBe(original.command)
    await choose("Agent", "OpenCode")
    await choose("Agent", "Custom ACP agent")
    expect(
      (screen.getByRole("textbox", { name: "ACP agent executable" }) as HTMLInputElement).value,
    ).toBe(original.command)
    expect(
      (screen.getByRole("textbox", { name: "Arguments (JSON array)" }) as HTMLInputElement).value,
    ).toBe(JSON.stringify(original.args))
    fireEvent.change(screen.getByRole("textbox", { name: "Arguments (JSON array)" }), {
      target: { value: "{" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Connect agent" }))
    expect(screen.getByRole("alert").textContent).toContain("JSON array")
    expect(chat.connect).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole("textbox", { name: "Arguments (JSON array)" }), {
      target: { value: JSON.stringify(original.args) },
    })
    await userEvent.click(screen.getByRole("button", { name: "Connect agent" }))
    expect(chat.connect).toHaveBeenCalledWith(original)
  })

  it("disconnects a changed agent and reports awaited cleanup through global activity", async () => {
    saveAssistantPreferences({ version: 1, agent: { command: "codex-acp", args: [] } })
    const cleanup = deferred()
    const chat = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockReturnValue(cleanup.promise),
    }
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected />)
    await choose("Agent", "Claude Code")
    expect(chat.disconnect).toHaveBeenCalledTimes(1)
    expect(chat.connect).not.toHaveBeenCalled()
    expect(screen.getByRole("status", { name: "Global activity" }).textContent).toBe("active")
    expect(screen.getByRole("combobox", { name: "Agent" }).hasAttribute("disabled")).toBe(true)
    expect(document.querySelector('[data-slot="spinner"]')).toBeNull()
    await act(async () => {
      cleanup.resolve()
      await cleanup.promise
    })
    expect(screen.getByRole("status", { name: "Global activity" }).textContent).toBe("idle")
  })

  it("preserves a custom API configuration but clears credentials when changing providers", async () => {
    const original = {
      endpoint: "https://api.example.test/v1/chat/completions",
      model: "private-model",
      stream: false,
      apiKey: "",
    }
    saveApiPreferences(original)
    const chat = { connect: vi.fn(), disconnect: vi.fn().mockResolvedValue(undefined) }
    show(<ApiConfigurationForm chat={chat} busy={false} connected={false} />)
    fireEvent.change(screen.getByLabelText("API key (optional)"), {
      target: { value: "runtime-secret" },
    })
    await choose("Provider", "Ollama")
    expect((screen.getByLabelText("API key (optional)") as HTMLInputElement).value).toBe("")
    expect((screen.getByRole("textbox", { name: "API model" }) as HTMLInputElement).value).toBe("")
    await choose("Provider", "Custom endpoint")
    expect(
      (screen.getByRole("textbox", { name: "Chat Completions endpoint URL" }) as HTMLInputElement)
        .value,
    ).toBe(original.endpoint)
    expect((screen.getByRole("textbox", { name: "API model" }) as HTMLInputElement).value).toBe(
      original.model,
    )
    expect((screen.getByLabelText("API key (optional)") as HTMLInputElement).value).toBe("")
    fireEvent.change(screen.getByLabelText("API key (optional)"), {
      target: { value: "new-runtime-secret" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Connect and enable project access" }))
    expect(chat.connect).toHaveBeenCalledWith({ ...original, apiKey: "new-runtime-secret" })
    expect(
      Object.keys(localStorage)
        .map((key) => localStorage.getItem(key))
        .join(),
    ).not.toContain("secret")
    expect(
      screen
        .getByRole("button", { name: "Connect and enable project access" })
        .hasAttribute("title"),
    ).toBe(false)
  })

  it("chooses an API preset without inventing a model or connecting automatically", async () => {
    const chat = { connect: vi.fn(), disconnect: vi.fn().mockResolvedValue(undefined) }
    show(<ApiConfigurationForm chat={chat} busy={false} connected={false} />)
    await choose("Provider", "LM Studio")
    expect(chat.connect).not.toHaveBeenCalled()
    expect((screen.getByRole("textbox", { name: "API model" }) as HTMLInputElement).value).toBe("")
    fireEvent.change(screen.getByRole("textbox", { name: "API model" }), {
      target: { value: "my-loaded-model" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Connect and enable project access" }))
    expect(chat.connect).toHaveBeenCalledWith({
      endpoint: "http://localhost:1234/v1/chat/completions",
      model: "my-loaded-model",
      apiKey: "",
      stream: true,
    })
  })

  it("uses only agent-advertised models and modes and reports their pending changes globally", async () => {
    const pending = deferred()
    const chat = {
      setModel: vi.fn().mockReturnValue(pending.promise),
      setMode: vi.fn().mockResolvedValue(undefined),
      setConfigOption: vi.fn().mockResolvedValue(undefined),
    }
    const snapshot: AssistantSnapshot = {
      projectId: "0195b5ac-b250-7a2c-8c33-000000000101",
      sessionToken: "session-token",
      sessionId: "session-id",
      canResume: false,
      status: "ready",
      modes: [{ id: "review", name: "Review" }],
      currentModeId: "review",
      models: [{ id: "advertised-model", name: "Advertised model" }],
      currentModelId: null,
      configOptions: [],
      attachmentCapabilities: { text: false, images: false },
      authMethods: [],
    }
    const view = show(<NativeSessionControls chat={chat} snapshot={snapshot} busy={false} />)
    expect(screen.getByRole("combobox", { name: "Agent mode" }).textContent).toContain("Review")
    await choose("Model", "Advertised model")
    expect(chat.setModel).toHaveBeenCalledWith("advertised-model")
    expect(screen.getByRole("combobox", { name: "Model" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("status", { name: "Global activity" }).textContent).toBe("active")
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(screen.getByRole("status", { name: "Global activity" }).textContent).toBe("idle")
    view.unmount()
    show(
      <NativeSessionControls
        chat={chat}
        snapshot={{ ...snapshot, modes: [], models: [] }}
        busy={false}
      />,
    )
    expect(screen.queryByRole("combobox")).toBeNull()
  })
})

describe("compact chat actions", () => {
  it("presents a failed connection once with actionable adapter guidance", () => {
    const failed: AssistantSnapshot = {
      projectId: "bracket",
      sessionToken: "failed-connection",
      status: "error",
      sessionId: null,
      canResume: false,
      modes: [],
      currentModeId: null,
      models: [],
      currentModelId: null,
      configOptions: [],
      attachmentCapabilities: { text: false, images: false },
      authMethods: [],
    }
    show(
      <ApplicationNoticesProvider>
        <AssistantPanel
          open
          projectName="Bracket"
          messages={[]}
          busy={false}
          canSend={false}
          configuration={null}
          sessionControls={
            <NativeSessionControls
              chat={{
                setMode: async () => {},
                setModel: async () => {},
                setConfigOption: async () => {},
              }}
              snapshot={failed}
              busy={false}
            />
          }
          error={messages.en.app.assistant.errors["launch-failed"]}
          storageFailed={false}
          onClose={() => {}}
          onSend={async () => {}}
          onCancel={async () => {}}
          onReset={async () => {}}
        />
      </ApplicationNoticesProvider>,
    )
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByRole("alert").textContent).toContain("codex-acp")
    expect(screen.getByRole("alert").textContent).toContain("absolute path")
    expect(screen.queryByText("Agent connection failed")).toBeNull()
    expect(screen.getByRole("complementary").querySelector('[role="alert"]')).toBeNull()
  })

  it("routes operational and history errors to the shared center without expanding the composer", () => {
    show(
      <ApplicationNoticesProvider>
        <AssistantPanel
          open
          projectName="Bracket"
          messages={[]}
          busy={false}
          canSend
          configuration={null}
          error="The agent disconnected."
          storageFailed
          onClose={() => {}}
          onSend={async () => {}}
          onCancel={async () => {}}
          onReset={async () => {}}
        />
      </ApplicationNoticesProvider>,
    )
    expect(screen.getAllByRole("alert")).toHaveLength(2)
    expect(screen.getByRole("complementary").querySelector('[role="alert"]')).toBeNull()
    expect(screen.getByRole("complementary").textContent).not.toContain("The agent disconnected.")
  })

  it("keeps icon names, tooltips and pending locks while reporting work only globally", async () => {
    const pending = deferred(),
      send = vi.fn().mockReturnValue(pending.promise),
      reset = vi.fn().mockResolvedValue(undefined)
    show(
      <AssistantPanel
        open
        projectName="Bracket"
        messages={[{ id: "one", role: "user", text: "Saved" }]}
        busy={false}
        canSend
        configuration={<p>Connection form</p>}
        sessionControls={<p>Advertised session controls</p>}
        error={null}
        storageFailed={false}
        onClose={() => {}}
        onSend={send}
        onCancel={async () => {}}
        onReset={reset}
      />,
    )
    for (const name of ["AI settings", "Close chat", "New chat", "Send"]) {
      const button = screen.getByRole("button", { name })
      expect(button.textContent).toBe("")
      expect(button.hasAttribute("title")).toBe(false)
    }
    expect(screen.getByText("Advertised session controls")).toBeTruthy()
    expect(screen.queryByRole("region", { name: "AI settings" })).toBeNull()
    const settings = screen.getByRole("button", { name: "AI settings" })
    fireEvent.focus(settings)
    expect(screen.getByRole("tooltip").textContent).toBe("AI settings")
    fireEvent.blur(settings)
    await userEvent.click(settings)
    expect(screen.getByRole("region", { name: "AI settings" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "New chat" }))
    expect(reset).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Hello" },
    })
    const button = screen.getByRole("button", { name: "Send" })
    await userEvent.click(button)
    fireEvent.click(button)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith("Hello")
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(screen.getByRole("status", { name: "Global activity" }).textContent).toBe("active")
    expect(document.querySelector('[data-slot="spinner"]')).toBeNull()
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Global activity" }).textContent).toBe("idle"),
    )
  })

  it("keeps Stop available during a prompt and guards repeated cancellation", async () => {
    const pending = deferred()
    const cancel = vi.fn().mockReturnValue(pending.promise)
    show(
      <AssistantPanel
        open
        projectName="Bracket"
        messages={[]}
        busy
        canSend
        configuration={null}
        error={null}
        storageFailed={false}
        onClose={() => {}}
        onSend={async () => {}}
        onCancel={cancel}
        onReset={async () => {}}
      />,
    )
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull()
    const stop = screen.getByRole("button", { name: "Stop" })
    await userEvent.click(stop)
    fireEvent.click(stop)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stop.getAttribute("aria-busy")).toBe("true")
    expect(screen.getByRole("status", { name: "Global activity" }).textContent).toBe("active")
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(stop.hasAttribute("disabled")).toBe(false)
    expect(screen.getByRole("status", { name: "Global activity" }).textContent).toBe("idle")
  })
})
