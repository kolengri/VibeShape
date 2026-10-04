import { I18nProvider, useTranslations } from "@vibeshape/i18n"
import { compareMessageCatalogs } from "@vibeshape/i18n/catalog"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { i18n, messages } from "./index"

describe("web message catalogs", () => {
  it("keeps every locale structurally compatible with canonical English", () => {
    for (const [locale, catalog] of Object.entries(messages)) {
      expect(compareMessageCatalogs(messages.en, catalog), locale).toEqual([])
    }
  })

  it("formats exact open Sweep curve options using valid ICU selector keys", () => {
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
})
