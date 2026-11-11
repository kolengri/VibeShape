import type { Page } from "@playwright/test"
import { LOCAL_AUTOMATION_PATH } from "../../packages/automation-api/src/local-session"

/**
 * Grants the embedded assistant's project automation connection (ADR-0126). A connected built-in
 * agent keeps its composer disabled until that connection is ready, so assistant fixtures that
 * replace the native bridge must also answer the local automation endpoints.
 */
export async function routeNativeProjectAccess(
  page: Page,
  client: { name: string; version: string },
  clientId: string,
) {
  await page.route(`**${LOCAL_AUTOMATION_PATH}/*`, async (route) => {
    const path = new URL(route.request().url()).pathname
    const body = path.endsWith("/status")
      ? { protocolVersion: 1, client, paired: false }
      : ["/connect", "/resume", "/renew"].some((endpoint) => path.endsWith(endpoint))
        ? {
            protocolVersion: 1,
            token: "l".repeat(43),
            actor: { type: "mcp", clientId, sessionId: "01900000-0000-7000-8000-000000000001" },
            expiresAt: Date.now() + 60 * 60_000,
            client,
          }
        : path.endsWith("/poll")
          ? { protocolVersion: 1, work: null, cancelledRequestIds: [] }
          : { ok: true }
    await route.fulfill({ json: body })
  })
}
