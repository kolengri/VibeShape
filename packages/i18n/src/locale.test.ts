import { describe, expect, it, vi } from "vitest"

import { findAvailableLocale, getLocaleDirection, persistLocale, readStoredLocale } from "./locale"

describe("locale resolution", () => {
  it("uses the first supported exact or base-language candidate", () => {
    const availableLocales = ["en", "de"] as const

    expect(findAvailableLocale(availableLocales, "fr-FR", "de-DE", "en")).toBe("de")
    expect(findAvailableLocale(availableLocales, "EN-us")).toBe("en")
  })

  it("ignores unsupported and malformed candidates", () => {
    expect(findAvailableLocale(["en"] as const, undefined, "", "fr-FR")).toBeUndefined()
  })

  it("maps locale direction without requiring browser-only Intl extensions", () => {
    expect(getLocaleDirection("en-US")).toBe("ltr")
    expect(getLocaleDirection("ar-EG")).toBe("rtl")
  })

  it("treats blocked preference storage as non-fatal", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("Storage is blocked")
      }),
      setItem: vi.fn(() => {
        throw new Error("Storage is blocked")
      }),
    } as unknown as Storage

    expect(readStoredLocale(storage, "locale")).toBeUndefined()
    expect(() => persistLocale(storage, "locale", "en")).not.toThrow()
  })
})
