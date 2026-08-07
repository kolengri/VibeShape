// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { createI18n, useTranslations } from "./index"
import { I18nProvider, useI18n } from "./provider"

const testI18n = createI18n({
  defaultLocale: "en",
  messages: {
    de: { test: { greeting: "Hallo" } },
    en: { test: { greeting: "Hello" } },
  },
  storageKey: "test-locale",
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

function LocaleHarness() {
  const t = useTranslations("test")
  const { locale, setLocale } = useI18n()

  return (
    <div>
      <p>{t("greeting")}</p>
      <p>Current locale: {locale}</p>
      <button type="button" onClick={() => setLocale("en")}>
        Switch to English
      </button>
    </div>
  )
}

afterEach(() => {
  cleanup()
  document.documentElement.lang = "en"
  document.documentElement.dir = "ltr"
})

describe("I18nProvider", () => {
  it("resolves a stored regional locale and persists runtime changes", async () => {
    const user = userEvent.setup()
    const storage = createMemoryStorage()
    storage.setItem("test-locale", "de-DE")

    render(
      <I18nProvider i18n={testI18n} storage={storage}>
        <LocaleHarness />
      </I18nProvider>,
    )

    expect(screen.getByText("Hallo")).not.toBeNull()
    expect(screen.getByText("Current locale: de")).not.toBeNull()

    await user.click(screen.getByRole("button", { name: "Switch to English" }))

    expect(screen.getByText("Hello")).not.toBeNull()
    expect(storage.getItem("test-locale")).toBe("en")
    expect(document.documentElement.lang).toBe("en")
    expect(document.documentElement.dir).toBe("ltr")
  })
})
