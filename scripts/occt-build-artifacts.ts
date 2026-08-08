import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"

const outputExtensions = ["js", "wasm", "d.ts"] as const

export function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function requireFile(path: string) {
  if (!existsSync(path)) {
    throw new Error(`Controlled OCCT build did not produce ${path}.`)
  }

  const bytes = statSync(path).size

  if (bytes === 0) {
    throw new Error(`Controlled OCCT build produced an empty file: ${path}.`)
  }

  return bytes
}

export function requireControlledBuildOutputs(inputDirectory: string, outputBaseName: string) {
  const javascriptPath = join(inputDirectory, `${outputBaseName}.${outputExtensions[0]}`)
  const wasmPath = join(inputDirectory, `${outputBaseName}.${outputExtensions[1]}`)
  const declarationPath = join(inputDirectory, `${outputBaseName}.${outputExtensions[2]}`)
  const outputFiles = [javascriptPath, wasmPath, declarationPath]

  const outputs = outputFiles.map((path) => ({
    bytes: requireFile(path),
    file: basename(path),
    sha256: sha256(path),
  }))

  const javascript = readFileSync(javascriptPath, "utf8")
  const declaration = readFileSync(declarationPath, "utf8")
  const wasmMagic = readFileSync(wasmPath).subarray(0, 4)

  if (!javascript.includes(`${outputBaseName}.wasm`)) {
    throw new Error("Controlled OCCT JavaScript does not reference its expected WASM file.")
  }

  if (!declaration.includes("VibeShapeAllocatorStats")) {
    throw new Error("Controlled OCCT declarations omit allocator instrumentation.")
  }

  if (
    !declaration.includes("VibeShapeOcctDiagnostics") ||
    !declaration.includes("PurgeAllocator") ||
    !declaration.includes("RunNativeBoxCycle") ||
    !declaration.includes("RunNativeCylinderCycle")
  ) {
    throw new Error("Controlled OCCT declarations omit native lifecycle instrumentation.")
  }

  if (!wasmMagic.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
    throw new Error("Controlled OCCT output does not have a WebAssembly header.")
  }

  return { outputFiles, outputs }
}

export function stageControlledBuildPackage(
  outputFiles: string[],
  packageDirectory: string,
  sourceRevision: string,
) {
  const sourceDirectory = join(packageDirectory, "src")
  rmSync(packageDirectory, { force: true, recursive: true })
  mkdirSync(sourceDirectory, { recursive: true })

  const stagedNames = ["replicad_single.js", "replicad_single.wasm", "replicad_single.d.ts"]

  for (const [index, outputFile] of outputFiles.entries()) {
    const stagedName = stagedNames[index]

    if (!stagedName) {
      throw new Error("Controlled OCCT staging received an unexpected output file.")
    }

    copyFileSync(outputFile, join(sourceDirectory, stagedName))
  }

  writeFileSync(
    join(packageDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "replicad-opencascadejs",
        version: `0.0.0-vibeshape-${sourceRevision.slice(0, 12)}`,
        private: true,
        type: "module",
        main: "src/replicad_single.js",
        files: ["src"],
      },
      null,
      2,
    )}\n`,
  )
}
