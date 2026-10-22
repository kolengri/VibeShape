import { createI18n, defaultFormats, mergeMessages } from "@vibeshape/i18n"
import uiEn from "@vibeshape/ui/messages/en.json"

import en from "./messages/en.json"

export const messages = { en: mergeMessages(en, uiEn) } as const
export type AppLocale = keyof typeof messages

export const i18n = createI18n({
  defaultLocale: "en",
  formats: defaultFormats,
  messages,
})
