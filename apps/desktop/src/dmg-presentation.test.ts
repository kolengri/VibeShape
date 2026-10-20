import { afterEach, describe, expect, it } from "bun:test"
import { writeFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join } from "node:path"
import { distributionHash } from "../../../scripts/local-distribution-files"
import { createDmgImage } from "../dmg-presentation"
import { withPackageOutput } from "../package-output"

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
type Call = { command: string; args: string[] }
function commandOperation(command: string, args: string[]) {
  if (command === "hdiutil") return args[0]
  if (command === "diskutil") return args[0]
  if (command === "osascript") return args[1]
  return command
}

function assertCommandSucceeds(
  operation: string | undefined,
  args: string[],
  failures: readonly string[],
) {
  const phase = operation === "detach" && args.includes("-force") ? "force-detach" : operation
  if (phase && failures.includes(phase)) throw new Error(`fixture ${phase} failed`)
}

function writeFinderLayout(mountPoint: string | undefined, failures: readonly string[]) {
  if (failures.includes("missing-layout")) return
  if (!mountPoint) throw new Error("Finder requires the attached mount path.")
  writeFileSync(
    join(mountPoint, ".DS_Store"),
    failures.includes("zero-layout") ? "" : "saved Finder layout",
  )
}

function writeCompressedImage(args: string[]) {
  const file = args[args.indexOf("-o") + 1]
  if (!file) throw new Error("The compressed image requires an output path.")
  writeFileSync(file, "verified compressed fixture")
}

async function fixture(failures: readonly string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-dmg-layout-"))
  directories.push(root)
  const original = join(root, "original/VibeShape.app")
  await mkdir(original, { recursive: true })
  await writeFile(join(original, "signed-runtime"), "keep original application")
  const calls: Call[] = []
  const output = join(root, "release")
  let stagePath = ""
  const run = (command: string, args: string[]) => {
    calls.push({ command, args })
    const operation = commandOperation(command, args)
    assertCommandSucceeds(operation, args, failures)
    if (command === "swift" && args[1]) writeFileSync(args[1], "background")
    if (operation === "configure") writeFinderLayout(args[2], failures)
    if (operation === "convert") writeCompressedImage(args)
    return ""
  }
  const build = () =>
    withPackageOutput(output, async (stage) => {
      stagePath = stage
      return createDmgImage(
        {
          stage,
          output,
          appPath: original,
          brandIcon: "existing-brand.png",
          version: "1.2.3",
          arch: "arm64",
        },
        run,
      )
    })
  return { root, output, original, calls, build, stage: () => stagePath }
}
const operations = (calls: Call[]) =>
  calls.map(({ command, args }) => commandOperation(command, args))
function attachedMount(calls: Call[]) {
  const args = calls.find(
    ({ command, args }) => command === "hdiutil" && args[0] === "attach",
  )?.args
  const mount = args?.[args.indexOf("-mountpoint") + 1]
  if (!mount) throw new Error("The image was not attached at an explicit mountpoint.")
  return mount
}
function createdVolume(calls: Call[]) {
  const args = calls.find(
    ({ command, args }) => command === "hdiutil" && args[0] === "create",
  )?.args
  const volume = args?.[args.indexOf("-volname") + 1]
  if (!volume) throw new Error("The image was not created with an explicit volume label.")
  return volume
}

describe("owned macOS installer presentation", () => {
  it("publishes an integrity-checked image only after closing and detaching its own mount", async () => {
    const f = await fixture()
    const result = await f.build()
    expect(result.dmg).toBe(join(f.output, "VibeShape-1.2.3-mac-arm64.dmg"))
    const order = operations(f.calls)
    expect(order.indexOf("configure")).toBeLessThan(order.indexOf("close"))
    expect(order.indexOf("close")).toBeLessThan(order.indexOf("renameVolume"))
    expect(order.indexOf("renameVolume")).toBeLessThan(order.indexOf("detach"))
    expect(order.indexOf("detach")).toBeLessThan(order.indexOf("convert"))
    expect(order.indexOf("convert")).toBeLessThan(order.indexOf("verify"))
    const mount = attachedMount(f.calls)
    expect(isAbsolute(mount)).toBe(true)
    expect(dirname(mount)).toBe(f.stage())
    expect(basename(mount)).toBe(createdVolume(f.calls))
    expect(createdVolume(f.calls)).toMatch(/^VibeShape-layout-[0-9a-f-]{36}$/)
    expect(f.calls.find(({ command }) => command === "diskutil")?.args).toEqual([
      "renameVolume",
      mount,
      "VibeShape",
    ])
    const rename = f.calls.findIndex(({ command }) => command === "diskutil")
    expect(f.calls.slice(rename + 1).some(({ command }) => command === "osascript")).toBe(false)
    expect(
      f.calls
        .filter(({ command }) => command === "osascript")
        .every(({ args }) => args[2] === mount),
    ).toBe(true)
    expect(
      f.calls.filter(({ args }) => args[0] === "detach").every(({ args }) => args.at(-1) === mount),
    ).toBe(true)
    expect(result.digest).toBe(distributionHash(await readFile(result.dmg)))
    expect(await readFile(join(f.output, "SHA256SUMS"), "utf8")).toBe(
      `${result.digest}  VibeShape-1.2.3-mac-arm64.dmg\n`,
    )
    expect(await readFile(join(f.original, "signed-runtime"), "utf8")).toBe(
      "keep original application",
    )
    await expect(stat(f.stage())).rejects.toThrow()
  })

  it("gives separate builds distinct temporary volume and Finder mount identities", async () => {
    const first = await fixture()
    const second = await fixture()
    await first.build()
    await second.build()
    expect(createdVolume(first.calls)).not.toBe(createdVolume(second.calls))
    expect(basename(attachedMount(first.calls))).not.toBe(basename(attachedMount(second.calls)))
  })

  it("stages the real application and an Applications link before Finder configuration", async () => {
    const f = await fixture(["configure"])
    let observedLink = ""
    let observedRuntime = ""
    // Keep the staging inspection inside the output owner, before its failure cleanup.
    await mkdir(f.output)
    const stage = join(f.output, "private-stage")
    await mkdir(stage)
    try {
      await createDmgImage(
        {
          stage,
          output: f.output,
          appPath: f.original,
          brandIcon: "brand.png",
          version: "1.2.3",
          arch: "arm64",
        },
        (command, args) => {
          if (command === "osascript" && args[1] === "configure")
            throw new Error("stop after staging")
          return ""
        },
      )
    } catch {
      observedLink = await readlink(join(stage, "image/Applications"))
      observedRuntime = await readFile(join(stage, "image/VibeShape.app/signed-runtime"), "utf8")
    }
    expect(observedLink).toBe("/Applications")
    expect(observedRuntime).toBe("keep original application")
  })

  for (const failure of [
    "attach",
    "configure",
    "close",
    "missing-layout",
    "zero-layout",
    "renameVolume",
  ]) {
    it(`attempts detachment and removes owned output after ${failure} failure`, async () => {
      const f = await fixture([failure])
      await expect(f.build()).rejects.toBeInstanceOf(AggregateError)
      expect(operations(f.calls)).toContain("detach")
      expect(operations(f.calls)).not.toContain("convert")
      if (failure !== "renameVolume") expect(operations(f.calls)).not.toContain("renameVolume")
      await expect(stat(f.output)).rejects.toThrow()
      expect(await readFile(join(f.original, "signed-runtime"), "utf8")).toBe(
        "keep original application",
      )
    })
  }
  it("falls back to forced detachment before publishing when ordinary eject is busy", async () => {
    const f = await fixture(["detach"])
    await f.build()
    expect(
      f.calls.filter(({ args }) => args[0] === "detach").map(({ args }) => args.includes("-force")),
    ).toEqual([false, true])
    expect(operations(f.calls)).toContain("verify")
  })
  it("refuses compression and checksums if both detach attempts fail", async () => {
    const f = await fixture(["detach", "force-detach"])
    await expect(f.build()).rejects.toBeInstanceOf(AggregateError)
    expect(f.calls.filter(({ args }) => args[0] === "detach")).toHaveLength(2)
    expect(operations(f.calls)).not.toContain("convert")
    await expect(stat(f.output)).rejects.toThrow()
  })
  for (const failure of ["convert", "verify"]) {
    it(`removes the image and never publishes checksums after ${failure} failure`, async () => {
      const f = await fixture([failure])
      await expect(f.build()).rejects.toThrow(failure)
      expect(operations(f.calls)).toContain("detach")
      await expect(stat(f.output)).rejects.toThrow()
    })
  }
})
