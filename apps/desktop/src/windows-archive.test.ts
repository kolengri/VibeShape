import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWindowsArchive } from "../windows-archive"

// The packaging entrypoint rejects other hosts; GNU tar cannot create this ZIP format.
test.skipIf(process.platform !== "darwin" && process.platform !== "win32")(
  "Windows ZIP preserves the complete runnable directory and matches its checksum",
  async () => {
    const output = await mkdtemp(join(tmpdir(), "vibeshape-windows-zip-"))
    try {
      const directory = join(output, "VibeShape-win32-x64")
      await mkdir(join(directory, "resources/editor/sources"), { recursive: true })
      await writeFile(join(directory, "VibeShape.exe"), "executable fixture")
      await writeFile(join(directory, "resources/editor/sources/LICENSE.txt"), "license fixture")
      await writeFile(join(output, "SHA256SUMS"), "existing Mac checksum\n")
      const archive = await createWindowsArchive({ directory, output, version: "1.2.3" })
      const bytes = await readFile(archive.zip)
      expect(bytes.subarray(0, 2).toString()).toBe("PK")
      expect(archive.digest).toBe(createHash("sha256").update(bytes).digest("hex"))
      expect(await readFile(join(output, "SHA256SUMS-win-x64"), "utf8")).toBe(
        `${archive.digest}  VibeShape-1.2.3-win-x64.zip\n`,
      )
      expect(await readFile(join(output, "SHA256SUMS"), "utf8")).toBe("existing Mac checksum\n")
      const extracted = join(output, "extracted")
      await mkdir(extracted)
      const result = spawnSync("tar", ["-xf", archive.zip, "-C", extracted], { encoding: "utf8" })
      expect(result.status).toBe(0)
      expect(await readFile(join(extracted, "VibeShape-win32-x64/VibeShape.exe"), "utf8")).toBe(
        "executable fixture",
      )
      expect(
        await readFile(
          join(extracted, "VibeShape-win32-x64/resources/editor/sources/LICENSE.txt"),
          "utf8",
        ),
      ).toBe("license fixture")
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)
