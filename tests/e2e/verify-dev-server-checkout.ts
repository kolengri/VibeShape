import { resolve } from "node:path"
import type { FullConfig } from "@playwright/test"
import { z } from "zod"

const checkoutRoot = resolve(import.meta.dirname, "../..")
const rootManifest = z.object({ name: z.literal("@vibeshape/root") })

/**
 * Playwright reuses any server already listening on the e2e port. Vite only serves `/@fs` files
 * inside its own workspace root, so a server started by another checkout rejects this one's
 * manifest and the run stops before testing foreign code.
 */
export default async function verifyDevServerCheckout(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL
  if (baseURL === undefined) throw new Error("The e2e configuration has no baseURL.")
  const response = await fetch(new URL(`/@fs${checkoutRoot}/package.json`, baseURL))
  const manifest = response.ok ? await response.json().catch(() => undefined) : undefined
  if (!rootManifest.safeParse(manifest).success) {
    throw new Error(
      `The dev server at ${baseURL} does not serve ${checkoutRoot} (HTTP ${response.status}). ` +
        "Another checkout probably owns the port; stop it or set VIBESHAPE_E2E_PORT.",
    )
  }
}
