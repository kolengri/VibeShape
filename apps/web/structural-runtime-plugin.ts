import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { extname, resolve } from "node:path"
import type { Plugin } from "vite"
import { STRUCTURAL_RUNTIME_FILES } from "../../scripts/structural-runtime-inputs.ts"

const directory = resolve(import.meta.dirname, "../../.artifacts/structural-runtime")
const assetNames = [
  ...STRUCTURAL_RUNTIME_FILES.map(({ name }) => name),
  "THIRD-PARTY-NOTICES.txt",
  "provenance.json",
]
function verifiedAsset(name: string) {
  let bytes: Buffer
  try {
    bytes = readFileSync(resolve(directory, name))
  } catch {
    throw new Error(
      "Structural runtime missing. Run bun run structural:prepare before starting or building VibeShape.",
    )
  }
  const input = STRUCTURAL_RUNTIME_FILES.find((file) => file.name === name)
  if (input && createHash("sha256").update(bytes).digest("hex") !== input.sha256)
    throw new Error(
      `Structural runtime checksum mismatch: ${name}. Run bun run structural:prepare.`,
    )
  return bytes
}
function contentType(name: string) {
  const types = new Map([
    [".mjs", "text/javascript; charset=utf-8"],
    [".wasm", "application/wasm"],
    [".json", "application/json"],
    [".txt", "text/plain; charset=utf-8"],
  ])
  return types.get(extname(name)) ?? "application/octet-stream"
}
export function structuralRuntimePlugin(): Plugin {
  let base = "/"
  return {
    name: "vibeshape-structural-runtime",
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0]
        const name = assetNames.find((asset) => pathname === `${base}structural-runtime/${asset}`)
        if (!name) return next()
        try {
          response.setHeader("Content-Type", contentType(name))
          response.setHeader("Cache-Control", "no-cache")
          response.end(verifiedAsset(name))
        } catch {
          response.statusCode = 503
          response.end("Run bun run structural:prepare to provision the local numerical runtime.")
        }
      })
    },
    generateBundle() {
      for (const name of assetNames)
        this.emitFile({
          type: "asset",
          fileName: `structural-runtime/${name}`,
          source: verifiedAsset(name),
        })
    },
  }
}
