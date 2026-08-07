import { createI18n, defaultFormats } from "@vibeshape/i18n"

import en from "./messages/en.json"

export const messages = { en } as const
export type AppLocale = keyof typeof messages

export const i18n = createI18n({
  defaultLocale: "en",
  formats: defaultFormats,
  messages,
})
