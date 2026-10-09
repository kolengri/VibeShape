import { afterEach, describe, expect, it } from "bun:test"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import rootManifest from "../package.json"
import { createDistributionManifest, verifyDistribution } from "./local-distribution-files"
import { installDistribution, rollbackDistribution } from "./local-distribution-install"

const temporary: string[] = []
function writableTree(directory: string) {
  chmodSync(directory, 0o700)
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (lstatSync(path).isDirectory()) writableTree(path)
  }
}
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    writableTree(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

function scenario() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "vibeshape local distribution "))
  temporary.push(directory)
  return { directory, destination: join(directory, "user selected installation") }
}

function packageFixture(root: string, name = "first", commit = "a".repeat(40)) {
  const directory = join(root, `${name} portable package`)
  mkdirSync(directory)
  const payload = [
    "vibeshape",
    "launcher.js",
    "apps/mcp-server/src/index.js",
    "apps/web/dist/index.html",
    "sources/vibeshape-source.tar",
    "LICENSE",
    "docs/local-distribution.md",
  ]
  for (const path of payload) {
    const target = join(directory, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${name}: ${path}\n`)
  }
  chmodSync(join(directory, "vibeshape"), 0o755)
  const manifest = createDistributionManifest(directory, commit)
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return { directory, manifest }
}

describe("portable local distribution installation", () => {
  it("records the repository Bun pin and verifies with a standalone bundled launcher", async () => {
    const { directory } = scenario()
    const pkg = packageFixture(directory)
    expect(`bun@${pkg.manifest.bunVersion}`).toBe(rootManifest.packageManager)
    const build = await Bun.build({
      entrypoints: [join(import.meta.dirname, "local-distribution.ts")],
      target: "bun",
      format: "esm",
      packages: "bundle",
    })
    expect(build.success).toBe(true)
    expect(build.outputs).toHaveLength(1)
    const launcher = join(directory, "standalone-launcher.js")
    const output = build.outputs[0]
    if (!output) throw new Error("The standalone launcher build produced no artifact.")
    await Bun.write(launcher, output)
    const result = Bun.spawnSync([process.execPath, launcher, "verify", pkg.directory], {
      cwd: directory,
      env: { ...process.env, NODE_PATH: undefined },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr.toString()).toBe("")
    expect(result.stdout.toString()).toContain(pkg.manifest.releaseId)
  })

  it("installs, updates and rolls back with immutable versions and spaces in paths", () => {
    const { directory, destination } = scenario()
    const first = packageFixture(directory)
    const second = packageFixture(directory, "second", "b".repeat(40))
    expect(installDistribution(first.directory, destination)).toBe(first.manifest.releaseId)
    expect(readlinkSync(join(destination, "current"))).toBe(`versions/${first.manifest.releaseId}`)
    const firstVersion = join(destination, "versions", first.manifest.releaseId)
    expect(lstatSync(firstVersion).mode & 0o222).toBe(0)
    const initial = readFileSync(join(firstVersion, "launcher.js"))
    expect(installDistribution(second.directory, destination)).toBe(second.manifest.releaseId)
    expect(readlinkSync(join(destination, "current"))).toBe(`versions/${second.manifest.releaseId}`)
    expect(readFileSync(join(firstVersion, "launcher.js"))).toEqual(initial)
    expect(rollbackDistribution(destination, first.manifest.releaseId)).toBe(
      first.manifest.releaseId,
    )
    expect(readlinkSync(join(destination, "current"))).toBe(`versions/${first.manifest.releaseId}`)
    expect(readdirSync(join(destination, "versions"))).toHaveLength(2)
    expect(verifyDistribution(firstVersion)).toEqual(first.manifest)
    expect(installDistribution(first.directory, destination)).toBe(first.manifest.releaseId)
  })

  it("refuses tampered or incomplete packages before creating an installation", () => {
    const { directory, destination } = scenario()
    const pkg = packageFixture(directory)
    writeFileSync(join(pkg.directory, "launcher.js"), "modified after manifest\n")
    expect(() => installDistribution(pkg.directory, destination)).toThrow(/inventory/)
    expect(existsSync(destination)).toBe(false)
    rmSync(join(pkg.directory, "manifest.json"))
    expect(() => installDistribution(pkg.directory, destination)).toThrow()
    expect(existsSync(destination)).toBe(false)
  })

  it("rejects unsafe manifests and extra content", () => {
    const { directory, destination } = scenario()
    const pkg = packageFixture(directory)
    writeFileSync(
      join(pkg.directory, "manifest.json"),
      JSON.stringify({ ...pkg.manifest, files: [{ ...pkg.manifest.files[0], path: "../escape" }] }),
    )
    expect(() => installDistribution(pkg.directory, destination)).toThrow(/safe relative/)
    writeFileSync(join(pkg.directory, "manifest.json"), JSON.stringify(pkg.manifest))
    writeFileSync(join(pkg.directory, "unexpected.txt"), "not inventoried")
    expect(() => installDistribution(pkg.directory, destination)).toThrow(/inventory/)
  })

  it("preserves unrelated files and rejects nested or filesystem-root installation", () => {
    const { directory, destination } = scenario()
    const pkg = packageFixture(directory)
    mkdirSync(destination)
    writeFileSync(join(destination, "personal.txt"), "keep this")
    expect(() => installDistribution(pkg.directory, destination)).toThrow(/unrelated files/)
    expect(readFileSync(join(destination, "personal.txt"), "utf8")).toBe("keep this")
    expect(readdirSync(destination)).toEqual(["personal.txt"])
    expect(() => installDistribution(pkg.directory, join(pkg.directory, "nested"))).toThrow(
      /outside the package/,
    )
    expect(() => installDistribution(pkg.directory, "/")).toThrow(/filesystem root/)
  })

  it("refuses package and destination symlinks, including dangling links", () => {
    const { directory, destination } = scenario()
    const pkg = packageFixture(directory)
    symlinkSync(pkg.directory, join(directory, "package alias"))
    expect(() => installDistribution(join(directory, "package alias"), destination)).toThrow(
      /Symlink/,
    )
    symlinkSync(join(directory, "missing"), destination)
    expect(() => installDistribution(pkg.directory, destination)).toThrow(/Symlink/)
    rmSync(destination)
    symlinkSync(join(pkg.directory, "LICENSE"), join(pkg.directory, "linked.txt"))
    expect(() => installDistribution(pkg.directory, destination)).toThrow(/symlinks/)
  })

  it("refuses unsafe current pointers, concurrent operations and missing rollback versions", () => {
    const { directory, destination } = scenario()
    const pkg = packageFixture(directory)
    installDistribution(pkg.directory, destination)
    expect(() => rollbackDistribution(destination, "../escape")).toThrow(/Invalid release/)
    expect(() =>
      rollbackDistribution(destination, `v1-${"c".repeat(12)}-${"d".repeat(24)}`),
    ).toThrow()
    mkdirSync(join(destination, ".install-lock"))
    expect(() => installDistribution(pkg.directory, destination)).toThrow()
    expect(readlinkSync(join(destination, "current"))).toBe(`versions/${pkg.manifest.releaseId}`)
    rmSync(join(destination, ".install-lock"), { recursive: true })
    rmSync(join(destination, "current"))
    symlinkSync(pkg.directory, join(destination, "current"))
    expect(() => rollbackDistribution(destination, pkg.manifest.releaseId)).toThrow(/unsafe target/)
    expect(readFileSync(join(pkg.directory, "launcher.js"), "utf8")).toContain("first")
  })

  it("does not overwrite a modified installed version", () => {
    const { directory, destination } = scenario()
    const pkg = packageFixture(directory)
    installDistribution(pkg.directory, destination)
    const launcher = join(destination, "versions", pkg.manifest.releaseId, "launcher.js")
    chmodSync(launcher, 0o644)
    writeFileSync(launcher, "user modification\n")
    expect(() => installDistribution(pkg.directory, destination)).toThrow(/inventory/)
    expect(readFileSync(launcher, "utf8")).toBe("user modification\n")
  })

  it("allows regular Finder metadata without trusting metadata symlinks", () => {
    const { directory, destination } = scenario()
    const pkg = packageFixture(directory)
    writeFileSync(join(pkg.directory, ".DS_Store"), "Finder metadata")
    mkdirSync(destination)
    writeFileSync(join(destination, ".DS_Store"), "preserve destination metadata")
    expect(installDistribution(pkg.directory, destination)).toBe(pkg.manifest.releaseId)
    expect(readFileSync(join(destination, ".DS_Store"), "utf8")).toBe(
      "preserve destination metadata",
    )
    expect(verifyDistribution(pkg.directory)).toEqual(pkg.manifest)
    rmSync(join(pkg.directory, ".DS_Store"))
    symlinkSync(join(pkg.directory, "LICENSE"), join(pkg.directory, ".DS_Store"))
    expect(() => verifyDistribution(pkg.directory)).toThrow(/regular file/)
  })

  it("rolls back from a damaged current version while preserving damaged contents", () => {
    const { directory, destination } = scenario()
    const first = packageFixture(directory)
    const second = packageFixture(directory, "second", "b".repeat(40))
    installDistribution(first.directory, destination)
    installDistribution(second.directory, destination)
    const damaged = join(destination, "versions", second.manifest.releaseId, "launcher.js")
    chmodSync(damaged, 0o644)
    writeFileSync(damaged, "damaged current release")
    expect(rollbackDistribution(destination, first.manifest.releaseId)).toBe(
      first.manifest.releaseId,
    )
    expect(readlinkSync(join(destination, "current"))).toBe(`versions/${first.manifest.releaseId}`)
    expect(readFileSync(damaged, "utf8")).toBe("damaged current release")
    expect(() => rollbackDistribution(destination, second.manifest.releaseId)).toThrow(/inventory/)
    expect(() => installDistribution(second.directory, destination)).toThrow(/inventory/)
  })
})
