import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type {
  AssistantConnectionTestResult,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
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
        <ApplicationNoticesProvider>
          <ApiAssistantProvider>
            {children}
            <ActivityReceipt />
          </ApiAssistantProvider>
        </ApplicationNoticesProvider>
      </I18nProvider>
    </ActivityProvider>,
  )
}
async function choose(label: string, option: string) {
  const select = screen.queryByRole("combobox", { name: label })
  fireEvent.keyDown(select ?? screen.getByRole("button", { name: label }), { key: "Enter" })
  await userEvent.click(screen.getByRole(select ? "option" : "menuitemradio", { name: option }))
}
function deferred<T = void>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function openSettings(configuration: ReactNode) {
  show(
    <AssistantPanel
      open
      projectName="Bracket"
      messages={[]}
      busy={false}
      canSend={false}
      configuration={configuration}
      error={null}
      storageFailed={false}
      onClose={() => {}}
      onSend={async () => {}}
      onCancel={async () => {}}
      onReset={async () => {}}
    />,
  )
  await userEvent.click(screen.getByRole("button", { name: "AI settings" }))
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
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
  it.each(["Jev (TypeSafe)", "Codex"])(
    "closes settings after %s connects successfully and restores trigger focus",
    async (agent) => {
      const pending = deferred<boolean>()
      const chat = {
        connect: vi.fn().mockReturnValue(pending.promise),
        disconnect: vi.fn().mockResolvedValue(undefined),
      }
      await openSettings(
        <NativeAgentConfiguration chat={chat} connecting={false} connected={false} />,
      )
      await choose("Agent", agent)
      const form = screen.getByRole("button", { name: "Connect agent" }).closest("form")
      expect(form).toBeTruthy()
      fireEvent.submit(form as HTMLFormElement)
      fireEvent.submit(form as HTMLFormElement)
      expect(chat.connect).toHaveBeenCalledTimes(1)
      expect(screen.getByRole("dialog", { name: "AI settings" })).toBeTruthy()
      expect(screen.getByRole("button", { name: "Connect agent" }).hasAttribute("disabled")).toBe(
        true,
      )
      await act(async () => pending.resolve(true))
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "AI settings" }))
    },
  )

  it("keeps settings and credentials after a failed connection, then closes on retry", async () => {
    const chat = {
      connect: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    await openSettings(
      <NativeAgentConfiguration chat={chat} connecting={false} connected={false} />,
    )
    await choose("Agent", "Jev (TypeSafe)")
    fireEvent.change(screen.getByLabelText("TypeSafe API key", { exact: true }), {
      target: { value: "retry-key" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Connect agent" }))
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(
      (screen.getByLabelText("TypeSafe API key", { exact: true }) as HTMLInputElement).value,
    ).toBe("retry-key")
    await userEvent.click(screen.getByRole("button", { name: "Connect agent" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(chat.connect).toHaveBeenCalledTimes(2)
  })

  it("closes API settings only after the pending connection is accepted", async () => {
    saveApiPreferences({
      endpoint: "https://api.example.test/v1/chat/completions",
      model: "configured-model",
      apiKey: "",
      stream: true,
    })
    const pending = deferred<boolean>()
    const chat = {
      connect: vi.fn().mockReturnValue(pending.promise),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    await openSettings(<ApiConfigurationForm chat={chat} busy={false} connected={false} />)
    const connect = screen.getByRole("button", { name: "Connect and enable project access" })
    await userEvent.click(connect)
    fireEvent.submit(connect.closest("form") as HTMLFormElement)
    expect(chat.connect).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("dialog")).toBeTruthy()
    await act(async () => pending.resolve(true))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

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
    expect(screen.getAllByRole("button")).toHaveLength(3)
    expect(screen.queryByRole("button", { name: "Agent mode" })).toBeNull()
    await choose("Reasoning effort", "Deep")
    expect(chat.setConfigOption).toHaveBeenCalledWith("opaque-reasoning", "deep")
    expect(screen.getByRole("button", { name: "Reasoning effort" }).textContent).toContain("Brief")
    expect(screen.getAllByRole("button").every((element) => element.hasAttribute("disabled"))).toBe(
      true,
    )
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(
      screen.getAllByRole("button").every((element) => !element.hasAttribute("disabled")),
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
    expect(screen.getByRole("button", { name: "Reasoning effort" }).textContent).toContain(
      "Extreme",
    )
    fireEvent.keyDown(screen.getByRole("button", { name: "Reasoning effort" }), { key: "Enter" })
    expect(screen.queryByRole("menuitemradio", { name: "Deep" })).toBeNull()
  })

  it("keeps advertised runtime choices inside the composer and releases the shared lock after rejection", async () => {
    let reject: (reason: Error) => void = () => {}
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    const chat = {
      setMode: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setConfigOption: vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined),
    }
    const snapshot: AssistantSnapshot = {
      projectId: "project",
      sessionToken: "session",
      sessionId: "agent-session",
      status: "ready",
      canResume: false,
      modes: [],
      models: [],
      currentModeId: null,
      currentModelId: null,
      authMethods: [],
      attachmentCapabilities: { text: false, images: false },
      configOptions: [
        {
          id: "mode",
          category: "mode",
          name: "Mode",
          currentValue: "auto-review",
          options: [{ id: "auto-review", name: "Auto review" }],
        },
        {
          id: "collaboration",
          name: "Collaboration mode",
          currentValue: "default",
          options: [{ id: "default", name: "Default" }],
        },
        {
          id: "model",
          category: "model",
          name: "Model",
          currentValue: "sol",
          options: [{ id: "sol", name: "6.1 Sol" }],
        },
        {
          id: "effort",
          category: "thought_level",
          name: "Reasoning effort",
          currentValue: "medium",
          options: [
            { id: "medium", name: "Medium" },
            { id: "high", name: "High" },
          ],
        },
        {
          id: "fast",
          name: "Fast mode",
          currentValue: "off",
          description: "Choose the agent service speed.",
          options: [
            { id: "off", name: "Off" },
            { id: "on", name: "On" },
          ],
        },
      ],
    }
    show(
      <AssistantPanel
        open
        projectName="Bracket"
        messages={[]}
        busy={false}
        canSend
        configuration={<p>Private connection settings</p>}
        sessionControls={<NativeSessionControls chat={chat} snapshot={snapshot} busy={false} />}
        error={null}
        storageFailed={false}
        onClose={() => {}}
        onSend={async () => {}}
        onCancel={async () => {}}
        onReset={async () => {}}
      />,
    )
    const composer = screen.getByRole("region", { name: "Message" })
    for (const [name, value] of [
      ["Mode", "Auto review"],
      ["Collaboration mode", "Default"],
      ["Model", "6.1 Sol"],
      ["Reasoning effort", "Medium"],
      ["Fast mode", "Off"],
    ] as const) {
      const button = within(composer).getByRole("button", { name })
      expect(button.textContent).toBe(value)
      expect(button.getAttribute("aria-description")).toBe(value)
    }
    const fast = within(composer).getByRole("button", { name: "Fast mode" })
    fireEvent.focus(fast)
    expect(screen.getByRole("tooltip").textContent).toBe("Fast mode: Off")
    fireEvent.blur(fast)
    await choose("Reasoning effort", "High")
    expect(chat.setConfigOption).toHaveBeenCalledTimes(1)
    expect(within(composer).getByRole("button", { name: "Model" }).hasAttribute("disabled")).toBe(
      true,
    )
    expect(within(composer).getByRole("button", { name: "Reasoning effort" }).textContent).toBe(
      "Medium",
    )
    await act(async () => {
      reject(new Error("Disconnected"))
      await pending.catch(() => {})
    })
    expect(screen.getByRole("alert").textContent).toContain("Reconnect and try again")
    expect(fast.hasAttribute("disabled")).toBe(false)
    await choose("Fast mode", "On")
    expect(chat.setConfigOption).toHaveBeenLastCalledWith("fast", "on")
    expect(screen.queryByRole("alert")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "AI settings" }))
    expect(screen.getByRole("dialog").textContent).toContain("Private connection settings")
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Model" })).toBeNull()
    await userEvent.keyboard("{Escape}")
    expect(within(composer).getByRole("button", { name: "Model" }).textContent).toBe("6.1 Sol")
  })

  it("releases a rejected probe for retry and clears its actionable error on success", async () => {
    const chat = {
      connect: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi
        .fn()
        .mockRejectedValueOnce(new Error("Transport closed"))
        .mockResolvedValue({ ok: true, checks: ["agent"] }),
    }
    saveAssistantPreferences({ version: 1, agent: { command: "/local/agent", args: [] } })
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected />)
    const test = screen.getByRole("button", { name: "Test connection" })
    await userEvent.click(test)
    expect(screen.getByRole("alert").textContent).toContain("Reconnect and try again")
    expect(test.hasAttribute("disabled")).toBe(false)
    await userEvent.click(test)
    expect(chat.testConnection).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(
      screen
        .getByText("ACP handshake passed. Provider access was not tested.")
        .closest('[data-tone="success"]'),
    ).toBeTruthy()
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

  it("connects the bundled Jev descriptor without paths and keeps credentials out of preferences", async () => {
    const pending = deferred<boolean>()
    const chat = {
      connect: vi.fn().mockReturnValue(pending.promise),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected={false} />)
    await choose("Agent", "Jev (TypeSafe)")
    expect(screen.queryByRole("textbox", { name: "ACP agent executable" })).toBeNull()
    fireEvent.change(screen.getByLabelText("TypeSafe API key", { exact: true }), {
      target: { value: "private-typesafe-key" },
    })
    const form = screen.getByRole("form", { name: "Jev settings" })
    await userEvent.click(screen.getByRole("button", { name: "Connect agent" }))
    fireEvent.submit(form)
    expect(chat.connect).toHaveBeenCalledTimes(1)
    expect(chat.connect).toHaveBeenCalledWith(
      {
        kind: "jev",
        settings: {
          model: "jev-1.14.0",
          images: true,
          maxSteps: 24,
          minConfidence: 0.5,
          timeoutMs: 60000,
        },
      },
      { apiKey: "private-typesafe-key" },
    )
    expect(readAssistantPreferences()?.agent).toMatchObject({ kind: "jev" })
    expect(JSON.stringify(readAssistantPreferences())).not.toContain("private-typesafe-key")
    await act(async () => pending.resolve(true))
    expect(new window.FormData(form as HTMLFormElement).get("apiKey")).toBe("")
  })

  it("tests Jev with the current settings without connecting, saving keys or submitting twice", async () => {
    const pending = deferred<AssistantConnectionTestResult>()
    const chat = {
      connect: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockReturnValue(pending.promise),
    }
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected={false} />)
    await choose("Agent", "Jev (TypeSafe)")
    fireEvent.change(screen.getByLabelText("TypeSafe API key", { exact: true }), {
      target: { value: "probe-private-key" },
    })
    expect(screen.queryByRole("checkbox", { name: /images/ })).toBeNull()
    const test = screen.getByRole("button", { name: "Test connection" })
    await userEvent.click(test)
    fireEvent.click(test)
    expect(chat.testConnection).toHaveBeenCalledTimes(1)
    expect(chat.testConnection).toHaveBeenCalledWith(
      {
        kind: "jev",
        settings: {
          model: "jev-1.14.0",
          images: true,
          maxSteps: 24,
          minConfidence: 0.5,
          timeoutMs: 60000,
        },
      },
      { apiKey: "probe-private-key" },
    )
    expect(screen.getByRole("button", { name: "Connect agent" }).hasAttribute("disabled")).toBe(
      true,
    )
    expect(screen.getByRole("combobox", { name: "Agent" }).hasAttribute("disabled")).toBe(true)
    expect(chat.connect).not.toHaveBeenCalled()
    expect(JSON.stringify(readAssistantPreferences())).not.toContain("probe-private-key")
    await act(async () => pending.resolve({ ok: true, checks: ["agent", "jev"] }))
    expect(
      screen
        .getByText(/Jev \(TypeSafe\) responded successfully/)
        .closest('[data-slot="notification"]')
        ?.getAttribute("data-tone"),
    ).toBe("success")
    expect(screen.getByText(/Jev \(TypeSafe\) responded successfully/).closest("form")).toBeNull()
    expect(
      (screen.getByLabelText("TypeSafe API key", { exact: true }) as HTMLInputElement).value,
    ).toBe("probe-private-key")
  })

  it("shows a safe provider failure, retains credentials for retry and invalidates stale results", async () => {
    const chat = {
      connect: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi
        .fn()
        .mockResolvedValue({ ok: false, code: "request-failed", stage: "jev", httpStatus: 401 }),
    }
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected={false} />)
    await choose("Agent", "Jev (TypeSafe)")
    const key = screen.getByLabelText("TypeSafe API key", { exact: true }) as HTMLInputElement
    fireEvent.change(key, { target: { value: "incorrect-key" } })
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }))
    expect(screen.getByRole("alert").textContent).toContain(
      "Jev (TypeSafe) connection test failed (HTTP 401)",
    )
    expect(key.value).toBe("incorrect-key")
    fireEvent.input(key, { target: { value: "corrected-key" } })
    expect(screen.queryByRole("alert")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }))
    expect(chat.testConnection).toHaveBeenLastCalledWith(expect.anything(), {
      apiKey: "corrected-key",
    })
    expect(chat.connect).not.toHaveBeenCalled()
  })

  it("tests the configured adapter while connected and reports the limited handshake scope", async () => {
    const chat = {
      connect: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue({ ok: true, checks: ["agent"] }),
    }
    saveAssistantPreferences({ version: 1, agent: { command: "/local/agent", args: ["acp"] } })
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected />)
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }))
    expect(chat.testConnection).toHaveBeenCalledWith(
      { command: "/local/agent", args: ["acp"] },
      undefined,
    )
    const success = screen.getByText("ACP handshake passed. Provider access was not tested.")
    expect(success.closest('[data-slot="notification"]')?.getAttribute("data-tone")).toBe("success")
    expect(success.closest('[data-slot="notification"]')?.querySelector("svg")).toBeTruthy()
    expect(success.closest("form")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))
    expect(screen.queryByText("ACP handshake passed. Provider access was not tested.")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }))
    expect(chat.testConnection).toHaveBeenCalledTimes(2)
    expect(
      screen.getAllByText("ACP handshake passed. Provider access was not tested."),
    ).toHaveLength(1)
    expect(chat.disconnect).not.toHaveBeenCalled()
  })

  it("retains both Jev keys after a reported connection failure and resends them on retry", async () => {
    let connected = false
    const chat = {
      connect: vi.fn(async () => connected),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected={false} />)
    await choose("Agent", "Jev (TypeSafe)")
    for (const [label, value] of [
      ["TypeSafe API key", "test-typesafe-key"],
      ["Argument model endpoint", "https://helper.test/v1/chat/completions"],
      ["Argument model name", "helper"],
      ["Argument model API key", "test-helper-key"],
    ] as const)
      fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
    const form = screen.getByRole("form", { name: "Jev settings" }) as HTMLFormElement
    const connect = screen.getByRole("button", { name: "Connect agent" })
    await userEvent.click(connect)
    await waitFor(() => expect(connect.hasAttribute("disabled")).toBe(false))
    expect(chat.connect).toHaveBeenCalledTimes(1)
    expect(new window.FormData(form).get("apiKey")).toBe("test-typesafe-key")
    expect(new window.FormData(form).get("argumentsApiKey")).toBe("test-helper-key")
    expect(JSON.stringify(readAssistantPreferences())).not.toContain("test-typesafe-key")
    expect(JSON.stringify(readAssistantPreferences())).not.toContain("test-helper-key")
    connected = true
    await userEvent.click(connect)
    expect(chat.connect).toHaveBeenCalledTimes(2)
    expect(chat.connect).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "jev" }), {
      apiKey: "test-typesafe-key",
      argumentsApiKey: "test-helper-key",
    })
    await waitFor(() => expect(new window.FormData(form).get("apiKey")).toBe(""))
    expect(new window.FormData(form).get("argumentsApiKey")).toBe("")
  })

  it("requires a complete argument model and preserves custom configuration across Jev selection", async () => {
    const original = { command: "/private/custom-acp", args: ["--acp"] }
    saveAssistantPreferences({ version: 1, agent: original })
    const chat = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected={false} />)
    await choose("Agent", "Jev (TypeSafe)")
    fireEvent.change(screen.getByLabelText("Argument model endpoint", { exact: true }), {
      target: { value: "https://helper.test/v1/chat/completions" },
    })
    fireEvent.submit(screen.getByRole("form", { name: "Jev settings" }))
    expect(chat.connect).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("both the argument endpoint and model")
    expect(readAssistantPreferences()?.agent).toEqual(original)
    await choose("Agent", "Custom ACP agent")
    expect(
      (screen.getByRole("textbox", { name: "ACP agent executable" }) as HTMLInputElement).value,
    ).toBe(original.command)
  })

  it("releases the Jev connection lock after rejection and retains the entered key for correction", async () => {
    const chat = {
      connect: vi.fn().mockRejectedValue(new Error("fixture failure")),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    show(<NativeAgentConfiguration chat={chat} connecting={false} connected={false} />)
    await choose("Agent", "Jev (TypeSafe)")
    fireEvent.change(screen.getByLabelText("TypeSafe API key", { exact: true }), {
      target: { value: "test-key" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Connect agent" }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined())
    expect(screen.getByRole("button", { name: "Connect agent" }).hasAttribute("disabled")).toBe(
      false,
    )
    const form = screen.getByRole("form", { name: "Jev settings" })
    expect(new window.FormData(form as HTMLFormElement).get("apiKey")).toBe("test-key")
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
    expect(screen.getByRole("button", { name: "Agent mode" }).textContent).toContain("Review")
    await choose("Model", "Advertised model")
    expect(chat.setModel).toHaveBeenCalledWith("advertised-model")
    expect(screen.getByRole("button", { name: "Model" }).hasAttribute("disabled")).toBe(true)
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
    expect(screen.queryByRole("button")).toBeNull()
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
    expect(screen.queryByRole("dialog", { name: "AI settings" })).toBeNull()
    const settings = screen.getByRole("button", { name: "AI settings" })
    fireEvent.focus(settings)
    expect(screen.getByRole("tooltip").textContent).toBe("AI settings")
    fireEvent.blur(settings)
    await userEvent.click(settings)
    expect(screen.getByRole("dialog", { name: "AI settings" }).getAttribute("aria-modal")).toBe(
      "true",
    )
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull()
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(settings)
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
