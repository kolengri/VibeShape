import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { nativeLicenseNotices } from "./notices"

const directory = import.meta.dirname
const output = join(directory, "dist")
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const inputs = new Set<string>()
const bundles: Record<string, unknown> = {}
for (const entry of ["main", "preload", "mcp"]) {
  const result = await Bun.build({
    entrypoints: [join(directory, `src/${entry}.ts`)],
    target: "node",
    format: "cjs",
    packages: "bundle",
    external: ["electron"],
    metafile: true,
    minify: false,
  })
  if (!result.success || result.outputs.length !== 1)
    throw new Error(`Desktop ${entry} build failed: ${result.logs.join("\n")}`)
  const bundle = result.outputs[0]
  if (!bundle) throw new Error("Desktop build produced no main process.")
  await Bun.write(join(output, `${entry}.cjs`), bundle)
  if (!result.metafile) throw new Error("Desktop build produced no dependency inventory.")
  bundles[entry] = result.metafile
  for (const input of Object.keys(result.metafile.inputs)) inputs.add(input)
}
await Bun.write(join(output, "metafile.json"), JSON.stringify({ bundles }, null, 2))
await Bun.write(
  join(output, "desktop-licenses.txt"),
  await nativeLicenseNotices([...inputs], directory),
)
console.log(
  "Built the native host, preload and MCP attachment; the editor is the existing Vite build.",
)
