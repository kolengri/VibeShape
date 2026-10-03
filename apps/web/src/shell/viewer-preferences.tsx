import { type PrinterProfile, printerProfileSchema } from "@vibeshape/protocol"
import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import { z } from "zod"
import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"

const STORAGE_KEY = "vibeshape.viewer-preferences.v1"
const preferencesSchema = z
  .object({
    version: z.literal(1),
    theme: z.enum(["dark", "light", "system"]),
    autoHideConsumedSketches: z.boolean(),
    preferredExportFormat: z.enum(["3mf", "step", "stl"]),
    printerProfile: printerProfileSchema.nullable().catch(null).default(null),
    printBedVisible: z.boolean().default(false),
    groundGridVisible: z.boolean().default(true),
  })
  .strict()

type Preferences = Omit<z.infer<typeof preferencesSchema>, "version">
export type ViewerPreferencesState = Preferences & {
  actions: {
    setPrinterProfile: (profile: PrinterProfile | null) => void
    setPrintBedVisible: (visible: boolean) => void
    setGroundGridVisible: (visible: boolean) => void
    setTheme: (theme: Preferences["theme"]) => void
    setAutoHideConsumedSketches: (hidden: boolean) => void
    setPreferredExportFormat: (format: Preferences["preferredExportFormat"]) => void
  }
}
type StorageLike = Pick<Storage, "getItem" | "setItem">
const defaults: Preferences = {
  printerProfile: null,
  printBedVisible: false,
  groundGridVisible: true,
  theme: "dark",
  autoHideConsumedSketches: true,
  preferredExportFormat: "3mf",
}

function browserStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function createViewerPreferencesStore(storage: StorageLike | null = browserStorage()) {
  let initial = defaults
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (raw && raw.length <= 4096) {
      const parsed = preferencesSchema.safeParse(JSON.parse(raw))
      if (parsed.success) {
        const { version: _version, ...preferences } = parsed.data
        initial = {
          ...preferences,
          printBedVisible: preferences.printBedVisible && preferences.printerProfile !== null,
        }
      }
    }
  } catch {
    /* Unavailable or corrupt storage leaves safe defaults. */
  }
  const store = createStore<ViewerPreferencesState>()((set) => ({
    ...initial,
    actions: {
      setPrinterProfile: (profile) =>
        set(
          profile === null
            ? { printerProfile: null, printBedVisible: false }
            : { printerProfile: printerProfileSchema.parse(profile) },
        ),
      setPrintBedVisible: (printBedVisible) => set({ printBedVisible }),
      setGroundGridVisible: (groundGridVisible) => set({ groundGridVisible }),
      setTheme: (theme) => set({ theme }),
      setAutoHideConsumedSketches: (autoHideConsumedSketches) => set({ autoHideConsumedSketches }),
      setPreferredExportFormat: (preferredExportFormat) => set({ preferredExportFormat }),
    },
  }))
  store.subscribe(
    ({
      theme,
      autoHideConsumedSketches,
      preferredExportFormat,
      printerProfile,
      printBedVisible,
      groundGridVisible,
    }) => {
      try {
        storage?.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: 1,
            theme,
            autoHideConsumedSketches,
            preferredExportFormat,
            printerProfile,
            printBedVisible,
            groundGridVisible,
          }),
        )
      } catch {
        /* Preferences remain usable in memory. */
      }
    },
  )
  return store
}

const PreferencesContext = createContext<ReturnType<typeof createViewerPreferencesStore> | null>(
  null,
)

function ThemeEffect({ store }: { store: ReturnType<typeof createViewerPreferencesStore> }) {
  const theme = useStore(store, (state) => state.theme)
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
      document.documentElement.style.colorScheme = dark ? "dark" : "light"
    }
    apply()
    if (theme !== "system") return
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])
  return null
}

export function ViewerPreferencesProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createViewerPreferencesStore())
  return (
    <PreferencesContext.Provider value={store}>
      <ThemeEffect store={store} />
      {children}
    </PreferencesContext.Provider>
  )
}

export function useViewerPreferences<Result>(selector: (state: ViewerPreferencesState) => Result) {
  const store = useContext(PreferencesContext)
  if (!store) throw new Error("useViewerPreferences requires ViewerPreferencesProvider.")
  return useStore(store, selector)
}
