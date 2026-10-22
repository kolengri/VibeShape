import { useTranslations } from "@vibeshape/i18n"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { ActivityProvider } from "@vibeshape/ui/components/activity"
import { FieldHelpProvider } from "@vibeshape/ui/components/field-help"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { type ReactNode, StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./app"
import { i18n } from "./i18n"
import { ApplicationNoticesProvider } from "./shell/application-notices"
import "./styles.css"

const rootElement = document.getElementById("root")

function LocalizedFieldHelpProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("ui.fieldHelp")
  return (
    <FieldHelpProvider
      formatLabel={(subject) => t.rich("forLabel", { subject: () => <>{subject}</> })}
    >
      {children}
    </FieldHelpProvider>
  )
}

if (!rootElement) {
  throw new Error("The VibeShape root element is missing.")
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <LocalizedFieldHelpProvider>
        <TooltipProvider delayDuration={500} skipDelayDuration={100}>
          <ActivityProvider>
            <ApplicationNoticesProvider>
              <App />
            </ApplicationNoticesProvider>
          </ActivityProvider>
        </TooltipProvider>
      </LocalizedFieldHelpProvider>
    </I18nProvider>
  </StrictMode>,
)
