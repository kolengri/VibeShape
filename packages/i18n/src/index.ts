import type { AbstractIntlMessages, Formats } from "use-intl"

import { findAvailableLocale } from "./locale"

export { compareMessageCatalogs, mergeMessages, type MessageCatalog } from "./catalog"
export {
  DEFAULT_LOCALE_STORAGE_KEY,
  findAvailableLocale,
  getBrowserLocaleCandidates,
  getBrowserStorage,
  getLocaleDirection,
  persistLocale,
  readStoredLocale,
} from "./locale"
export { I18nProvider, useI18n } from "./provider"
export { useFormatter, useLocale, useTranslations } from "use-intl"

export const defaultFormats = {
  dateTime: {
    short: {
      day: "numeric",
      month: "short",
      year: "numeric",
    },
    shortTime: {
      day: "numeric",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "long",
    },
  },
  number: {
    precise: {
      maximumFractionDigits: 6,
    },
  },
} as const satisfies Formats

export interface I18nInstance<Locale extends string = string> {
  readonly availableLocales: readonly Locale[]
  readonly defaultLocale: Locale
  readonly formats: Formats
  readonly messages: Readonly<Record<Locale, AbstractIntlMessages>>
  readonly storageKey: string
  getMessages(locale: Locale): AbstractIntlMessages
  hasLocale(locale: string): locale is Locale
  resolveLocale(...candidates: readonly unknown[]): Locale
}

export interface I18nConfig<
  Locale extends string,
  Catalogs extends Readonly<Record<Locale, AbstractIntlMessages>>,
> {
  defaultLocale: Locale
  formats?: Formats
  messages: Catalogs
  storageKey?: string
}

export function createI18n<
  const Catalogs extends Readonly<Record<string, AbstractIntlMessages>>,
  const DefaultLocale extends keyof Catalogs & string,
>(config: I18nConfig<DefaultLocale | (keyof Catalogs & string), Catalogs>) {
  type Locale = keyof Catalogs & string
  const availableLocales = Object.freeze(Object.keys(config.messages) as Locale[])
  const defaultLocale = config.defaultLocale as Locale

  if (!availableLocales.includes(defaultLocale)) {
    throw new Error(`Default locale is not present in the message catalogs: ${defaultLocale}`)
  }
  const defaultMessages = config.messages[defaultLocale]
  if (!defaultMessages) {
    throw new Error(`Default locale has no message catalog: ${defaultLocale}`)
  }

  const instance: I18nInstance<Locale> = {
    availableLocales,
    defaultLocale,
    formats: config.formats ?? defaultFormats,
    messages: config.messages,
    storageKey: config.storageKey ?? "vibeshape-locale",
    getMessages(locale) {
      return config.messages[locale] ?? defaultMessages
    },
    hasLocale(locale): locale is Locale {
      return availableLocales.includes(locale as Locale)
    },
    resolveLocale(...candidates) {
      return findAvailableLocale(availableLocales, ...candidates) ?? defaultLocale
    },
  }

  return instance
}
