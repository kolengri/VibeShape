import { afterEach, describe, expect, it } from "bun:test"
import { I18nProvider, useTranslations } from "@vibeshape/i18n"
import { compareMessageCatalogs } from "@vibeshape/i18n/catalog"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { vi } from "../../../../tests/unit/support/bun-test"

import { i18n, messages } from "./index"

afterEach(() => vi.unstubAllGlobals())

describe("web message catalogs", () => {
  it("keeps every locale structurally compatible with canonical English", () => {
    for (const [locale, catalog] of Object.entries(messages)) {
      expect(compareMessageCatalogs(messages.en, catalog), locale).toEqual([])
    }
  })

  it("formats exact open Sweep curve options using valid ICU selector keys", () => {
    vi.stubGlobal("navigator", { language: "en", languages: ["en"] })
    const kinds = ["line", "arc", "cubic_bezier", "elliptical_arc"] as const
    function CurveOptions() {
      const t = useTranslations("app.sweepLoft")
      return createElement(
        "p",
        null,
        kinds.map((kind) => t("curveOption", { kind, number: 1 })).join("|"),
      )
    }
    const rendered = renderToStaticMarkup(
      createElement(I18nProvider, {
        i18n,
        initialLocale: "en",
        children: createElement(CurveOptions),
      }),
    )
    expect(rendered).toBe("<p>Line 1|Arc 1|Bezier 1|Elliptical arc 1</p>")
  })
  it("exposes English as the safe fallback locale", () => {
    expect(i18n.defaultLocale).toBe("en")
    expect(i18n.resolveLocale("unsupported")).toBe("en")
  })
  it("formats every blocking project stage as valid ICU copy", () => {
    vi.stubGlobal("navigator", { language: "en", languages: ["en"] })
    function Stages() {
      const t = useTranslations("app.projectFile")
      return createElement(
        "p",
        null,
        ["creating", "deleting", "duplicating", "openingFile", "switching"]
          .map((activity) => t("activity", { activity }))
          .join("|"),
      )
    }
    const rendered = renderToStaticMarkup(
      createElement(I18nProvider, {
        i18n,
        initialLocale: "en",
        children: createElement(Stages),
      }),
    )
    expect(rendered).toBe(
      "<p>Creating project…|Deleting project…|Duplicating project…|Opening project file…|Opening project…</p>",
    )
  })
})
