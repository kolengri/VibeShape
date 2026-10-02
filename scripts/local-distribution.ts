import { realpathSync } from "node:fs"
import { join, resolve } from "node:path"
import { z } from "zod"
import { DISTRIBUTION_BUN_VERSION, verifyDistribution } from "./local-distribution-files"
import { installDistribution, rollbackDistribution } from "./local-distribution-install"

function verify(root: string, args: string[]) {
  const parsed = z.array(z.string().min(1)).max(1).parse(args)
  const manifest = verifyDistribution(parsed[0] ? resolve(parsed[0]) : root)
  console.log(`Verified ${manifest.releaseId} (${manifest.files.length} files).`)
}

function install(root: string, args: string[]) {
  const [destination] = z.tuple([z.string().min(1)]).parse(args)
  const release = installDistribution(root, destination)
  console.log(
    `Installed ${release}.\nMCP executable: ${join(resolve(destination), "current/vibeshape")}\nMCP arguments: mcp --port 43114\nStart the client or editor explicitly; existing processes and client configuration are unchanged.`,
  )
}

function rollback(_root: string, args: string[]) {
  const [destination, releaseId] = z.tuple([z.string().min(1), z.string().min(1)]).parse(args)
  console.log(
    `Current release: ${rollbackDistribution(destination, releaseId)}. Existing processes are unchanged.`,
  )
}

async function launch(root: string, args: string[], editor: boolean) {
  verifyDistribution(root)
  const server = join(root, "apps/mcp-server/src/index.js")
  process.argv = [process.execPath, server, ...(editor ? ["--editor"] : []), ...args]
  await import(server)
}

const actions = {
  verify,
  install,
  rollback,
  mcp: (root: string, args: string[]) => launch(root, args, false),
  editor: (root: string, args: string[]) => launch(root, args, true),
}

async function run() {
  if (Bun.version !== DISTRIBUTION_BUN_VERSION)
    throw new Error(`Use installed Bun ${DISTRIBUTION_BUN_VERSION}; found ${Bun.version}.`)
  const [name, ...args] = process.argv.slice(2)
  const command = z.enum(["verify", "install", "rollback", "mcp", "editor"]).safeParse(name)
  if (!command.success)
    throw new Error(
      "Usage: vibeshape mcp|editor [--port N] | verify [PACKAGE] | install DIRECTORY | rollback DIRECTORY RELEASE_ID",
    )
  await actions[command.data](realpathSync(import.meta.dirname), args)
}

if (import.meta.main) {
  try {
    await run()
  } catch (error) {
    process.stderr.write(
      `VibeShape: ${error instanceof Error ? error.message : "Local distribution operation failed."}\n`,
    )
    process.exitCode = 1
  }
}
