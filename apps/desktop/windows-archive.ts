import { spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { distributionHash } from "../../scripts/local-distribution-files"
import { desktopArtifactName } from "./src/desktop-platform"

export async function createWindowsArchive(input: {
  directory: string
  output: string
  version: string
}) {
  const fileName = desktopArtifactName(input.version, "x64", "win32")
  const zip = join(input.output, fileName)
  const result =
    process.platform === "darwin"
      ? spawnSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", input.directory, zip], {
          encoding: "utf8",
        })
      : spawnSync("tar", ["-a", "-cf", zip, basename(input.directory)], {
          cwd: dirname(input.directory),
          encoding: "utf8",
        })
  if (result.status !== 0)
    throw new Error(`Windows ZIP creation failed: ${result.error ?? result.stderr}`)
  const digest = distributionHash(await readFile(zip))
  await writeFile(join(input.output, "SHA256SUMS-win-x64"), `${digest}  ${fileName}\n`)
  return { zip, digest }
}
