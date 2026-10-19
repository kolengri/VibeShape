import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withPackageOutput } from "../package-output"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function destination() {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-package-output-"))
  roots.push(root)
  return join(root, "release")
}

describe("exclusive desktop package output", () => {
  for (const failure of ["packager", "codesign", "hdiutil", "source-consistency"]) {
    it(`removes all owned artifacts after ${failure} failure`, async () => {
      const output = await destination()
      await expect(
        withPackageOutput(output, async (stage) => {
          await writeFile(join(stage, "temporary"), "staging")
          await writeFile(join(output, "VibeShape.dmg"), "incomplete artifact")
          throw new Error(failure)
        }),
      ).rejects.toThrow(failure)
      await expect(stat(output)).rejects.toThrow()
    })
  }
  it("preserves a preexisting output without invoking the build", async () => {
    const output = await destination()
    await mkdir(output)
    await writeFile(join(output, "existing"), "keep")
    let invoked = false
    await expect(
      withPackageOutput(output, async () => {
        invoked = true
      }),
    ).rejects.toThrow()
    expect(invoked).toBe(false)
    expect(await readFile(join(output, "existing"), "utf8")).toBe("keep")
  })
  it("keeps successful artifacts and removes only private staging", async () => {
    const output = await destination()
    expect(
      await withPackageOutput(output, async (stage) => {
        await writeFile(join(stage, "temporary"), "staging")
        await writeFile(join(output, "desktop-build.json"), "receipt")
        return "ready"
      }),
    ).toBe("ready")
    expect(await readdir(output)).toEqual(["desktop-build.json"])
    expect(await readFile(join(output, "desktop-build.json"), "utf8")).toBe("receipt")
  })
})
