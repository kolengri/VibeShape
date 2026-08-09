import { randomBytes } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import {
  slicerBridgeOriginSchema,
  slicerBridgeTokenSchema,
} from "@vibeshape/slicer-handoff/protocol"
import { isError, isString } from "is-what"
import { z } from "zod"

const bridgeConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    origin: slicerBridgeOriginSchema,
    token: slicerBridgeTokenSchema,
  })
  .strict()

export type BridgeConfiguration = z.infer<typeof bridgeConfigurationSchema>

export type BridgeArguments = Readonly<{
  configPath: string | null
  origin: string | null
  resetPairing: boolean
  help: boolean
}>

function argumentValue(argv: readonly string[], index: number, option: string) {
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`)
  return value
}

export function parseBridgeArguments(argv: readonly string[]): BridgeArguments {
  let configPath: string | null = null
  let origin: string | null = null
  let resetPairing = false
  let help = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--config") {
      configPath = argumentValue(argv, index, argument)
      index += 1
      continue
    }
    if (argument === "--origin") {
      origin = argumentValue(argv, index, argument)
      index += 1
      continue
    }
    if (argument === "--reset-pairing") {
      resetPairing = true
      continue
    }
    if (argument === "--help" || argument === "-h") {
      help = true
      continue
    }
    throw new Error(`Unknown slicer bridge option: ${String(argument)}`)
  }

  return { configPath, origin, resetPairing, help }
}

function defaultConfigDirectory(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  home: string,
) {
  if (platform === "win32" && environment.APPDATA) {
    return join(environment.APPDATA, "VibeShape")
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "VibeShape")
  }
  return join(environment.XDG_CONFIG_HOME ?? join(home, ".config"), "vibeshape")
}

export function resolveBridgeConfigPath(input: {
  requestedPath: string | null
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  home?: string
}) {
  if (input.requestedPath) {
    if (!isAbsolute(input.requestedPath)) throw new Error("--config must use an absolute path.")
    return input.requestedPath
  }
  return join(
    defaultConfigDirectory(
      input.platform ?? process.platform,
      input.environment ?? process.env,
      input.home ?? homedir(),
    ),
    "slicer-bridge.json",
  )
}

function errorCode(error: unknown) {
  if (!isError(error)) return null
  const code = Reflect.get(error, "code")
  return isString(code) ? code : null
}

async function readConfiguration(path: string) {
  try {
    return bridgeConfigurationSchema.parse(JSON.parse(await readFile(path, "utf8")))
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null
    throw error
  }
}

async function writeNewConfiguration(path: string, configuration: BridgeConfiguration) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(configuration, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
}

async function replaceConfiguration(path: string, configuration: BridgeConfiguration) {
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(configuration, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function createToken() {
  return randomBytes(32).toString("base64url")
}

export async function loadBridgeConfiguration(input: {
  path: string
  origin: string | null
  resetPairing: boolean
  generateToken?: () => string
}) {
  const existing = await readConfiguration(input.path)
  const requestedOrigin = input.origin ? slicerBridgeOriginSchema.parse(input.origin) : null
  const generateToken = input.generateToken ?? createToken

  if (!existing) {
    if (!requestedOrigin) {
      throw new Error("First start requires --origin with the exact VibeShape application origin.")
    }
    const configuration = bridgeConfigurationSchema.parse({
      schemaVersion: 1,
      origin: requestedOrigin,
      token: generateToken(),
    })
    try {
      await writeNewConfiguration(input.path, configuration)
      return configuration
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error
      return bridgeConfigurationSchema.parse(JSON.parse(await readFile(input.path, "utf8")))
    }
  }

  if (!input.resetPairing) {
    if (requestedOrigin && requestedOrigin !== existing.origin) {
      throw new Error("The configured origin differs; use --reset-pairing to replace it.")
    }
    return existing
  }

  const configuration = bridgeConfigurationSchema.parse({
    schemaVersion: 1,
    origin: requestedOrigin ?? existing.origin,
    token: generateToken(),
  })
  await replaceConfiguration(input.path, configuration)
  return configuration
}

export const SLICER_BRIDGE_HELP = `VibeShape Slicer Bridge

Usage:
  bun run slicer:bridge -- --origin <exact-app-origin>
  bun run slicer:bridge -- --reset-pairing [--origin <exact-app-origin>]

Options:
  --origin <origin>   Pair one exact HTTP or HTTPS VibeShape origin.
  --config <path>     Use an absolute configuration path.
  --reset-pairing     Rotate the bearer token and optionally replace the origin.
  --help              Show this help.
`
