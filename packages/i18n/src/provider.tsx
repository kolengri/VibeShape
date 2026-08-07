import * as React from "react"
import { IntlProvider, type Locale } from "use-intl"

import type { I18nInstance } from "./index"
import {
  getBrowserLocaleCandidates,
  getBrowserStorage,
  getLocaleDirection,
  persistLocale,
  readStoredLocale,
} from "./locale"

export interface I18nContextValue {
  availableLocales: readonly Locale[]
  locale: Locale
  setLocale(locale: Locale): boolean
}

const I18nContext = React.createContext<I18nContextValue | undefined>(undefined)

export interface I18nProviderProps {
  children: React.ReactNode
  i18n: I18nInstance<Locale>
  initialLocale?: Locale
  storage?: Storage
}

export function I18nProvider({
  children,
  i18n,
  initialLocale,
  storage: providedStorage,
}: I18nProviderProps) {
  const storage = providedStorage ?? getBrowserStorage()
  const [locale, setLocaleState] = React.useState(() =>
    i18n.resolveLocale(
      initialLocale,
      readStoredLocale(storage, i18n.storageKey),
      ...getBrowserLocaleCandidates(),
      i18n.defaultLocale,
    ),
  )

  const setLocale = React.useCallback(
    (nextLocale: Locale) => {
      if (!i18n.hasLocale(nextLocale)) {
        return false
      }

      setLocaleState(nextLocale)
      return true
    },
    [i18n],
  )

  React.useEffect(() => {
    persistLocale(storage, i18n.storageKey, locale)
    document.documentElement.lang = locale
    document.documentElement.dir = getLocaleDirection(locale)
  }, [i18n.storageKey, locale, storage])

  const context = React.useMemo<I18nContextValue>(
    () => ({ availableLocales: i18n.availableLocales, locale, setLocale }),
    [i18n.availableLocales, locale, setLocale],
  )

  return (
    <I18nContext.Provider value={context}>
      <IntlProvider formats={i18n.formats} locale={locale} messages={i18n.getMessages(locale)}>
        {children}
      </IntlProvider>
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const context = React.useContext(I18nContext)
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider.")
  }

  return context
}
