import { createI18n, type defaultFormats } from "@vibeshape/i18n"
import type { AbstractIntlMessages } from "use-intl"
import en from "./messages/en.json"

const messages = { en } satisfies Record<"en", AbstractIntlMessages>

export const i18n = createI18n({ defaultLocale: "en", messages })

declare module "use-intl" {
  interface AppConfig {
    Formats: typeof defaultFormats
    Locale: "en"
    Messages: typeof en
  }
}
