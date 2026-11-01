import { afterEach, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { distributionHash } from "./local-distribution-files"
import { verifyControlledEditorBuild } from "./local-editor-build"

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture(script = false) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "vibeshape-controlled-editor-"))
  temporary.push(directory)
  const write = (file: string, bytes: string | Uint8Array) => {
    mkdirSync(dirname(join(directory, file)), { recursive: true })
    writeFileSync(join(directory, file), bytes)
    return { file, sha256: distributionHash(bytes) }
  }
  const artifacts = [
    write("assets/replicad_single-kernel.wasm", "controlled kernel"),
    write("assets/vibeshape_slvs-solver.wasm", "controlled solver"),
  ]
  if (script)
    artifacts.push(
      write(
        "assets/emscripten-module-script.wasm",
        readFileSync(
          resolve(
            import.meta.dirname,
            "../apps/web/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm",
          ),
        ),
      ),
    )
  const sourceArchives = [
    "occt-corresponding-source.tar",
    "solvespace-corresponding-source.tar.gz",
  ].map((name) => write(`sources/${name}`, name))
  for (const name of [
    "LICENSE.txt",
    "OCCT-NOTICES.txt",
    "Noto-Sans-OFL.txt",
    "Noto-Sans-provenance.md",
    "opentype-js-MIT.txt",
    "OCCT-REPLACEMENT.txt",
    "index.html",
  ])
    write(`sources/${name}`, name)
  const report = {
    schemaVersion: 1,
    kernelRevision: "bb368e271e24f63078129283148ce83db6b9670a",
    sourceManifestSha256: "a".repeat(64),
    artifacts,
    sourceArchives,
  }
  const save = () => write("local-build.json", JSON.stringify(report))
  save()
  return { directory, artifacts, write, save }
}

it("retains compatibility with controlled kernel and solver builds", () => {
  expect(verifyControlledEditorBuild(fixture().directory)).toMatch(/^[a-f0-9]{64}$/)
})
it("packages the exact reviewed QuickJS release alongside the controlled kernel and solver", () => {
  expect(verifyControlledEditorBuild(fixture(true).directory)).toMatch(/^[a-f0-9]{64}$/)
})
it("keeps the separately verified numerical runtime outside the editor asset report", () => {
  const value = fixture(true)
  value.write("structural-runtime/pyodide.asm.wasm", "separately verified numerical runtime")
  expect(verifyControlledEditorBuild(value.directory)).toMatch(/^[a-f0-9]{64}$/)
})
it("rejects an unknown third WASM even when its report hash matches its bytes", () => {
  const value = fixture()
  value.artifacts.push(value.write("assets/emscripten-module-other.wasm", "unreviewed runtime"))
  value.save()
  expect(() => verifyControlledEditorBuild(value.directory)).toThrow("Unreviewed")
})
it("rejects tampered runtime bytes and undeclared extra WASM files", () => {
  const value = fixture(true)
  value.write("assets/emscripten-module-script.wasm", "tampered runtime")
  expect(() => verifyControlledEditorBuild(value.directory)).toThrow("hash mismatch")
  const undeclared = fixture()
  undeclared.write("assets/hidden.WASM", "unknown runtime")
  expect(() => verifyControlledEditorBuild(undeclared.directory)).toThrow("unrecorded")
})
it("rejects duplicate runtime roles and omission of the controlled solver", () => {
  const value = fixture()
  value.artifacts[1] = value.write("assets/replicad_single-duplicate.wasm", "duplicate kernel")
  value.save()
  expect(() => verifyControlledEditorBuild(value.directory)).toThrow("one kernel, one solver")
})
