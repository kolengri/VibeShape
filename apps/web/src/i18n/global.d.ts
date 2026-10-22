import { defaultFormats } from "@vibeshape/i18n"

import type { AppLocale, messages } from "./index"

declare module "use-intl" {
  interface AppConfig {
    Formats: typeof defaultFormats
    Locale: AppLocale
    Messages: (typeof messages)["en"]
  }
}
