export const DEFAULT_LOCALE_STORAGE_KEY = "vibeshape-locale"

const rtlLanguages = new Set(["ar", "ckb", "dv", "fa", "he", "ps", "sd", "ug", "ur", "yi"])

function localeCandidates(candidate: string): string[] {
  const normalized = candidate.trim().replaceAll("_", "-")
  if (!normalized) {
    return []
  }

  const language = normalized.split("-")[0]
  return language && language !== normalized ? [normalized, language] : [normalized]
}

export function findAvailableLocale<const Locale extends string>(
  availableLocales: readonly Locale[],
  ...candidates: readonly unknown[]
): Locale | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue
    }

    for (const resolvedCandidate of localeCandidates(candidate)) {
      const locale = availableLocales.find(
        (availableLocale) => availableLocale.toLowerCase() === resolvedCandidate.toLowerCase(),
      )
      if (locale) {
        return locale
      }
    }
  }

  return undefined
}

export function readStoredLocale(
  storage: Storage | undefined,
  storageKey: string,
): string | undefined {
  if (!storage) {
    return undefined
  }

  try {
    return storage.getItem(storageKey) ?? undefined
  } catch {
    return undefined
  }
}

export function persistLocale(
  storage: Storage | undefined,
  storageKey: string,
  locale: string,
): void {
  if (!storage) {
    return
  }

  try {
    storage.setItem(storageKey, locale)
  } catch {
    // Locale persistence is a preference; storage failure must not prevent the editor from loading.
  }
}

export function getBrowserLocaleCandidates(): readonly string[] {
  if (typeof navigator === "undefined") {
    return []
  }

  return navigator.languages.length > 0 ? navigator.languages : [navigator.language]
}

export function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") {
    return undefined
  }

  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function getLocaleDirection(locale: string): "ltr" | "rtl" {
  const language = locale.trim().replaceAll("_", "-").split("-")[0]?.toLowerCase()
  return language && rtlLanguages.has(language) ? "rtl" : "ltr"
}
