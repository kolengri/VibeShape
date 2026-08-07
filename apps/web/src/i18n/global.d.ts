import { defaultFormats } from "@vibeshape/i18n"

import type { AppLocale } from "./index"
import en from "./messages/en.json"

declare module "use-intl" {
  interface AppConfig {
    Formats: typeof defaultFormats
    Locale: AppLocale
    Messages: typeof en
  }
}
