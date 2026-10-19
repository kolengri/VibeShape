import { I18nProvider } from "@vibeshape/i18n"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import { i18n } from "./i18n"
import "./styles.css"

const root = document.getElementById("root")
if (!root) throw new Error("The site root is missing.")

createRoot(root).render(
  <StrictMode>
    <I18nProvider i18n={i18n} initialLocale="en">
      <App />
    </I18nProvider>
  </StrictMode>,
)
