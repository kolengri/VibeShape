import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { requireControlledBuildOutputs, stageControlledBuildPackage } from "./occt-build-artifacts"

const temporaryDirectories: string[] = []

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "vibeshape-occt-artifacts-"))
  temporaryDirectories.push(directory)
  writeFileSync(
    join(directory, "vibeshape_occt.js"),
    'const wasm = "vibeshape_occt.wasm"; export default wasm;\n',
  )
  writeFileSync(
    join(directory, "vibeshape_occt.d.ts"),
    "export interface VibeShapeAllocatorStats {}\nexport interface VibeShapeOcctDiagnostics { PurgeAllocator(): number; RunNativeBoxCycle(): number; RunNativeCylinderCycle(): number }\n",
  )
  writeFileSync(join(directory, "vibeshape_occt.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d]))
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe(requireControlledBuildOutputs.name, () => {
  it("validates and records the controlled output set", () => {
    const fixture = createFixture()
    const result = requireControlledBuildOutputs(fixture, "vibeshape_occt")

    expect(result.outputs.map(({ bytes, file }) => ({ bytes, file }))).toEqual([
      { bytes: 57, file: "vibeshape_occt.js" },
      { bytes: 4, file: "vibeshape_occt.wasm" },
      { bytes: 178, file: "vibeshape_occt.d.ts" },
    ])
    expect(result.outputs.every((output) => output.sha256.length === 64)).toBe(true)
  })

  it("rejects an output without allocator instrumentation", () => {
    const fixture = createFixture()
    writeFileSync(join(fixture, "vibeshape_occt.d.ts"), "export {};\n")

    expect(() => requireControlledBuildOutputs(fixture, "vibeshape_occt")).toThrow(
      "Controlled OCCT declarations omit allocator instrumentation.",
    )
  })
})

describe(stageControlledBuildPackage.name, () => {
  it("stages a package compatible with the existing adapter import", () => {
    const fixture = createFixture()
    const { outputFiles } = requireControlledBuildOutputs(fixture, "vibeshape_occt")
    const packageDirectory = join(fixture, "package")

    stageControlledBuildPackage(outputFiles, packageDirectory, "bb368e271e24f630")

    expect(JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"))).toMatchObject({
      name: "replicad-opencascadejs",
      version: "0.0.0-vibeshape-bb368e271e24",
      main: "src/replicad_single.js",
    })
    expect(readFileSync(join(packageDirectory, "src", "replicad_single.wasm"))).toEqual(
      Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    )
  })
})
