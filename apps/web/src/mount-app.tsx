import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./app"
import { i18n } from "./i18n"
import "./styles.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("The VibeShape root element is missing.")
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <TooltipProvider delayDuration={500} skipDelayDuration={100}>
        <App />
      </TooltipProvider>
    </I18nProvider>
  </StrictMode>,
)
