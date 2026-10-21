import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { strFromU8, unzipSync } from "fflate"
import { STRUCTURAL_RUNTIME_FILES, STRUCTURAL_RUNTIME_VERSION } from "./structural-runtime-inputs"

const root = resolve(import.meta.dirname, "..")
const destination = resolve(root, ".artifacts/structural-runtime")
await mkdir(destination, { recursive: true })
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
type RuntimeInput = (typeof STRUCTURAL_RUNTIME_FILES)[number]
async function publishAsset(name: string, bytes: Uint8Array | string) {
  const target = resolve(destination, name)
  const temporary = resolve(root, ".artifacts", `structural-runtime-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, bytes, { flag: "wx" })
    // Parallel test processes must never observe a truncated runtime or provenance file.
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}
async function cachedAsset(input: RuntimeInput) {
  try {
    const cached = await readFile(resolve(destination, input.name))
    return digest(cached) === input.sha256 ? cached : null
  } catch {
    return null
  }
}
async function upstreamAsset(input: RuntimeInput) {
  if (input.npm)
    return readFile(
      resolve(root, "packages/structural-optimization/node_modules/pyodide", input.name),
    )
  const url =
    "url" in input
      ? input.url
      : `https://cdn.jsdelivr.net/pyodide/v${STRUCTURAL_RUNTIME_VERSION}/full/${input.name}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Cannot prepare ${input.name}: HTTP ${response.status}.`)
  return new Uint8Array(await response.arrayBuffer())
}
async function prepareAsset(input: RuntimeInput) {
  const cached = await cachedAsset(input)
  if (cached) return { name: input.name, bytes: cached }
  const bytes = await upstreamAsset(input)
  if (digest(bytes) !== input.sha256)
    throw new Error(`Structural runtime checksum mismatch: ${input.name}.`)
  await publishAsset(input.name, bytes)
  return { name: input.name, bytes }
}
const files = await Promise.all(STRUCTURAL_RUNTIME_FILES.map(prepareAsset))
const notices: string[] = []
for (const file of files) {
  if (file.name.endsWith("LICENSE.txt")) notices.push(`${file.name}\n\n${strFromU8(file.bytes)}`)
  if (!file.name.endsWith(".whl")) continue
  const licenses = unzipSync(file.bytes, {
    filter: ({ name }) => /(?:license|copying|notice)/i.test(name) && !name.endsWith("/"),
  })
  if (Object.keys(licenses).length === 0) throw new Error(`No retained license in ${file.name}.`)
  for (const [name, bytes] of Object.entries(licenses))
    notices.push(`${file.name}: ${name}\n\n${strFromU8(bytes)}`)
}
await publishAsset("THIRD-PARTY-NOTICES.txt", notices.join("\n\n---\n\n"))
await publishAsset(
  "provenance.json",
  JSON.stringify(
    {
      runtimeVersion: STRUCTURAL_RUNTIME_VERSION,
      inputs: STRUCTURAL_RUNTIME_FILES,
      upstreamSources: [
        "https://github.com/pyodide/pyodide/tree/314.0.7",
        "https://github.com/python/cpython/tree/v3.14.2",
        "https://github.com/numpy/numpy/tree/v2.4.6",
        "https://github.com/scipy/scipy/tree/v1.18.0",
        "https://github.com/kinnala/scikit-fem/tree/12.0.2",
        "https://github.com/mikedh/trimesh/tree/4.12.2",
      ],
    },
    null,
    2,
  ),
)
console.info(
  `Prepared verified local structural runtime (${files.reduce((sum, file) => sum + file.bytes.byteLength, 0)} bytes).`,
)
