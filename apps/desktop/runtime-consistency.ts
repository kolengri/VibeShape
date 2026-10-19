import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { distributionHash } from "../../scripts/local-distribution-files"

export async function verifyRuntimeFiles(
  directory: string,
  runtime: Readonly<Record<string, string>>,
) {
  for (const [name, digest] of Object.entries(runtime)) {
    if (distributionHash(await readFile(join(directory, name))) !== digest)
      throw new Error(`The desktop runtime changed: ${name}`)
  }
}
