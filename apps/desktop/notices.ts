import { existsSync } from "node:fs"
import { readdir, readFile, realpath } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"

async function isNamedPackage(directory: string) {
  const path = join(directory, "package.json")
  if (!existsSync(path)) return false
  const metadata = z
    .object({ name: z.string().min(1).optional() })
    .parse(JSON.parse(await readFile(path, "utf8")))
  return Boolean(metadata.name)
}

async function dependencyDirectory(input: string) {
  let directory = dirname(await realpath(input))
  while (!(await isNamedPackage(directory))) {
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`Bundled input lacks package metadata: ${input}`)
    directory = parent
  }
  return directory
}

async function packageNotice(directory: string) {
  const metadata = z
    .object({ name: z.string(), version: z.string(), license: z.string() })
    .parse(JSON.parse(await readFile(join(directory, "package.json"), "utf8")))
  const files = (await readdir(directory)).filter((name) =>
    /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name),
  )
  if (!files.length)
    throw new Error(`Bundled dependency lacks retained license text: ${metadata.name}`)
  const texts = await Promise.all(
    files.sort().map((name) => readFile(join(directory, name), "utf8")),
  )
  return `${metadata.name}@${metadata.version} (${metadata.license})\n\n${texts.join("\n\n")}`
}

export async function nativeLicenseNotices(inputs: readonly string[], base: string) {
  const directories = await Promise.all(
    inputs
      .filter((input) => input.includes("node_modules/"))
      .map((input) => dependencyDirectory(resolve(base, input))),
  )
  return (await Promise.all([...new Set(directories)].sort().map(packageNotice))).join(
    "\n\n---\n\n",
  )
}
