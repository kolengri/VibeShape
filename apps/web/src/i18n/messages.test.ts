import { compareMessageCatalogs } from "@vibeshape/i18n/catalog"
import { describe, expect, it } from "vitest"

import { i18n, messages } from "./index"

describe("web message catalogs", () => {
  it("keeps every locale structurally compatible with canonical English", () => {
    for (const [locale, catalog] of Object.entries(messages)) {
      expect(compareMessageCatalogs(messages.en, catalog), locale).toEqual([])
    }
  })

  it("exposes English as the safe fallback locale", () => {
    expect(i18n.defaultLocale).toBe("en")
    expect(i18n.resolveLocale("unsupported")).toBe("en")
  })
})
