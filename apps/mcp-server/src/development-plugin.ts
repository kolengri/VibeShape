import type { Plugin, ViteDevServer } from "vite"
import { createDevelopmentBridge, DEVELOPMENT_MCP_PATH } from "./development-bridge"

export function developmentMcpPlugin(): Plugin {
  let bridge: ReturnType<typeof createDevelopmentBridge> | undefined
  return {
    name: "vibeshape-development-mcp",
    apply: "serve",
    config: (config) => ({ server: { host: config.server?.host ?? "localhost" } }),
    configureServer(server) {
      const host = developmentHost(server)
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address()
        if (!address || typeof address === "string") return
        const origin = `http://${host === "::1" ? "[::1]" : host}:${address.port}`
        bridge = createDevelopmentBridge(origin)
        server.config.logger.info(`  Local MCP: ${origin}${DEVELOPMENT_MCP_PATH}`)
      })
      server.middlewares.use((request, response, next) => {
        if (!bridge?.handles(request.url ?? "/")) return next()
        void bridge.handle(request, response)
      })
    },
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { name: "vibeshape-local-automation", content: "1" },
        injectTo: "head",
      },
    ],
    async closeBundle() {
      await bridge?.close()
      bridge = undefined
    },
  }
}
function developmentHost(server: ViteDevServer) {
  if (!server.httpServer || server.config.server.https)
    throw new Error("Development MCP requires a standalone HTTP Vite server.")
  return loopbackHost(server.config.server.host)
}

function loopbackHost(host: string | boolean | undefined) {
  if (typeof host !== "string" || !["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error("Development MCP requires --host 127.0.0.1, localhost, or ::1.")
  return host
}
