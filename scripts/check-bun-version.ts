import { readFile } from "node:fs/promises"

const manifestUrl = new URL("../package.json", import.meta.url)
const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
  packageManager?: string
}
const expectedVersion = manifest.packageManager?.match(/^bun@(.+)$/)?.[1]

if (!expectedVersion) {
  console.error("The root packageManager field must pin an exact Bun version.")
  process.exit(1)
}

if (Bun.version !== expectedVersion) {
  console.error(`VibeShape requires Bun ${expectedVersion}; found ${Bun.version}.`)
  process.exit(1)
}

console.log(`Bun ${Bun.version} matches packageManager.`)
