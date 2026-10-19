import { I18nProvider } from "@vibeshape/i18n/provider"
import { ActivityProvider } from "@vibeshape/ui/components/activity"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./app"
import { i18n } from "./i18n"
import { ApplicationNoticesProvider } from "./shell/application-notices"
import "./styles.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("The VibeShape root element is missing.")
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <TooltipProvider delayDuration={500} skipDelayDuration={100}>
        <ActivityProvider>
          <ApplicationNoticesProvider>
            <App />
          </ApplicationNoticesProvider>
        </ActivityProvider>
      </TooltipProvider>
    </I18nProvider>
  </StrictMode>,
)
