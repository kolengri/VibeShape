import {
  MAX_SLICER_HANDOFF_BYTES,
  SLICER_BRIDGE_HOST,
  SLICER_BRIDGE_PORT,
} from "@vibeshape/slicer-handoff/protocol"
import { isError } from "is-what"
import {
  loadBridgeConfiguration,
  parseBridgeArguments,
  resolveBridgeConfigPath,
  SLICER_BRIDGE_HELP,
} from "./config"
import {
  cleanupStaleHandoffFiles,
  createHandoffFileStore,
  defaultHandoffDirectory,
} from "./handoff-files"
import { createSlicerBridgeHandler } from "./server"

async function main() {
  const arguments_ = parseBridgeArguments(process.argv.slice(2))
  if (arguments_.help) {
    process.stdout.write(SLICER_BRIDGE_HELP)
    return
  }
  const configPath = resolveBridgeConfigPath({ requestedPath: arguments_.configPath })
  const configuration = await loadBridgeConfiguration({
    path: configPath,
    origin: arguments_.origin,
    resetPairing: arguments_.resetPairing,
  })
  const handoffDirectory = defaultHandoffDirectory()
  await cleanupStaleHandoffFiles(handoffDirectory)
  const handler = createSlicerBridgeHandler({
    configuration,
    fileStore: createHandoffFileStore(handoffDirectory),
  })
  const server = Bun.serve({
    hostname: SLICER_BRIDGE_HOST,
    port: SLICER_BRIDGE_PORT,
    maxRequestBodySize: MAX_SLICER_HANDOFF_BYTES,
    fetch: handler,
  })

  process.stdout.write(
    [
      "VibeShape Slicer Bridge is ready.",
      `Paired origin: ${configuration.origin}`,
      `Connection token: ${configuration.token}`,
      `Loopback endpoint: ${server.url.origin}`,
      "Keep this terminal open while using one-click slicer handoff.",
      "",
    ].join("\n"),
  )

  const stop = async () => {
    await server.stop(false)
    process.exitCode = 0
  }
  process.once("SIGINT", () => void stop())
  process.once("SIGTERM", () => void stop())
}

main().catch((error: unknown) => {
  const message = isError(error) ? error.message : "Slicer bridge startup failed."
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
