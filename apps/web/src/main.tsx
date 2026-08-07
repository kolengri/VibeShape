import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { I18nProvider } from "@vibeshape/i18n/provider"

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
      <App />
    </I18nProvider>
  </StrictMode>,
)
