// Identifies which checkout a running Vite dev server transforms modules from.
const moduleSpecifier = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g
const entryScript = /<script\b[^>]*\bsrc="([^"]+)"/g
const MAX_MODULES = 40

/** Vite's `/@fs` URL prefix for files below `directory`, on POSIX and Windows paths alike. */
export function fsUrlPrefix(directory: string) {
  return `/@fs/${directory.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "")}/`
}

async function fetchText(url: URL) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.pathname}`)
  return response.text()
}

/**
 * Returns the first `/@fs` import Vite emits while transforming the app's own modules. Vite writes
 * files outside its root, such as workspace packages, as absolute `/@fs` paths of the serving
 * checkout, so this names that checkout even when its workspace root contains other checkouts.
 */
async function firstServedFsImport(baseURL: string) {
  const html = await fetchText(new URL("/", baseURL))
  const queue = [...html.matchAll(entryScript)].map(([, source]) => source ?? "")
  const seen = new Set<string>()
  while (queue.length > 0 && seen.size < MAX_MODULES) {
    const path = queue.shift()?.split("?")[0]
    if (!path?.startsWith("/") || path.startsWith("/@") || seen.has(path)) continue
    seen.add(path)
    for (const [, specifier = ""] of (await fetchText(new URL(path, baseURL))).matchAll(
      moduleSpecifier,
    )) {
      if (specifier.startsWith("/@fs/")) return specifier
      if (specifier.startsWith("/") && !specifier.startsWith("/node_modules/"))
        queue.push(specifier)
    }
  }
  return undefined
}

/** Rejects unless the dev server at `baseURL` transforms this checkout's application modules. */
export async function verifyDevServerCheckout(baseURL: string, checkoutRoot: string) {
  const advice = "Another checkout probably owns the port; stop it or set VIBESHAPE_E2E_PORT."
  let served: string | undefined
  try {
    served = await firstServedFsImport(baseURL)
  } catch (error) {
    throw new Error(`The dev server at ${baseURL} is not a VibeShape editor. ${advice}`, {
      cause: error,
    })
  }
  if (served === undefined)
    throw new Error(
      `Could not identify the checkout served at ${baseURL}: no module imported a /@fs path. ${advice}`,
    )
  if (!served.startsWith(fsUrlPrefix(checkoutRoot)))
    throw new Error(`The dev server at ${baseURL} serves ${served}, not ${checkoutRoot}. ${advice}`)
}
