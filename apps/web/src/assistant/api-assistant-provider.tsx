import { createContext, type ReactNode, useContext, useMemo, useState } from "react"
import {
  type ApiConfiguration,
  apiConfigurationSchema,
  readApiPreferences,
  saveApiPreferences,
} from "./api-assistant-preferences"

type ApiAssistantSettings = Readonly<{
  configuration: ApiConfiguration
  configure: (configuration: ApiConfiguration) => boolean
}>
const ApiAssistantContext = createContext<ApiAssistantSettings | null>(null)

export function ApiAssistantProvider({ children }: { children: ReactNode }) {
  const [configuration, setConfiguration] = useState<ApiConfiguration>(() => ({
    ...(readApiPreferences() ?? { endpoint: "", model: "", stream: true }),
    apiKey: "",
  }))
  const settings = useMemo<ApiAssistantSettings>(
    () => ({
      configuration,
      configure(next) {
        const parsed = apiConfigurationSchema.parse(next)
        setConfiguration(parsed)
        return saveApiPreferences(parsed)
      },
    }),
    [configuration],
  )
  return <ApiAssistantContext.Provider value={settings}>{children}</ApiAssistantContext.Provider>
}

export function useApiAssistantSettings() {
  const settings = useContext(ApiAssistantContext)
  if (!settings) throw new Error("Browser project chat requires ApiAssistantProvider.")
  return settings
}
