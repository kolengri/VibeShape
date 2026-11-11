import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import type { FullConfig } from "@playwright/test"
import { verifyDevServerCheckout } from "../../scripts/e2e-dev-server-checkout"

/**
 * Playwright reuses any server already listening on the e2e port, including one started by another
 * checkout or by an ancestor directory whose workspace contains this checkout. Stop before any test
 * runs unless the server transforms this checkout's modules.
 */
export default async function verifyReusedDevServer(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL
  if (baseURL === undefined) throw new Error("The e2e configuration has no baseURL.")
  // Vite reports real paths, so resolve symlinked checkout locations the same way.
  await verifyDevServerCheckout(baseURL, realpathSync(resolve(import.meta.dirname, "../..")))
}
