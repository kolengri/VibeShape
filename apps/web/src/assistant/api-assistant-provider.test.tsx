import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { readApiPreferences } from "./api-assistant-preferences"
import { ApiAssistantProvider, useApiAssistantSettings } from "./api-assistant-provider"

afterEach(() => {
  cleanup()
  localStorage.clear()
})
function Project({ id }: { id: string }) {
  const settings = useApiAssistantSettings()
  return (
    <>
      <p>
        {id}: {settings.configuration.apiKey || "No runtime key"}
      </p>
      <button
        type="button"
        onClick={() =>
          settings.configure({
            endpoint: "https://api.example.test/v1/chat/completions",
            model: "user-model",
            stream: true,
            apiKey: "runtime-secret",
          })
        }
      >
        Configure
      </button>
    </>
  )
}
describe("API credential lifetime", () => {
  it("keeps credentials across project remounts but loses them with the provider while retaining nonsecret preferences", () => {
    const element = (id: string) => (
      <ApiAssistantProvider>
        <Project key={id} id={id} />
      </ApiAssistantProvider>
    )
    const view = render(element("first"))
    fireEvent.click(screen.getByRole("button", { name: "Configure" }))
    expect(screen.getByText("first: runtime-secret")).toBeTruthy()
    view.rerender(element("second"))
    expect(screen.getByText("second: runtime-secret")).toBeTruthy()
    expect(
      Object.keys(localStorage)
        .map((key) => localStorage.getItem(key))
        .join(),
    ).not.toContain("runtime-secret")
    expect(readApiPreferences()).toMatchObject({
      endpoint: "https://api.example.test/v1/chat/completions",
      model: "user-model",
    })
    view.unmount()
    render(element("fresh"))
    expect(screen.getByText("fresh: No runtime key")).toBeTruthy()
    expect(readApiPreferences()?.model).toBe("user-model")
  })
})
