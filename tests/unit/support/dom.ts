import { JSDOM } from "jsdom"
import "./vite-imports"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:3000/",
  pretendToBeVisual: true,
})
const window = dom.window
const browserGlobals = new Set([
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "Event",
  "EventTarget",
  "CustomEvent",
  "Blob",
  "File",
  "FileReader",
  "FormData",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
])
for (const name of Object.getOwnPropertyNames(window)) {
  if (name in globalThis && !browserGlobals.has(name)) continue
  const value = Reflect.get(window, name)
  Object.defineProperty(globalThis, name, {
    value: typeof value === "function" && /^[a-z]/.test(name) ? value.bind(window) : value,
    writable: true,
    configurable: true,
  })
}
Object.defineProperty(globalThis, "window", { value: window, writable: true, configurable: true })

export function setDomUrl(url: string) {
  dom.reconfigure({ url })
}
