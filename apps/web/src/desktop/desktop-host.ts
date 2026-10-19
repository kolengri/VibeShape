import {
  type DesktopHostBridge,
  desktopMcpSetupSchema,
} from "@vibeshape/automation-api/desktop-host"

declare global {
  interface Window {
    vibeshapeDesktop?: DesktopHostBridge
  }
}

export function getDesktopHost() {
  const host = window.vibeshapeDesktop
  return host?.protocolVersion === 1 ? host : undefined
}

export async function readDesktopMcpSetup() {
  const host = getDesktopHost()
  if (!host) return null
  return desktopMcpSetupSchema.parse(await host.getMcpSetup())
}
