import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { sha256 } from "./occt-build-artifacts"
import { OCCT_BUILD_INPUTS } from "./occt-build-config"

const upstreamDestructorPolicy = `    nonPublicDestructor = any(x.kind == clang.cindex.CursorKind.DESTRUCTOR and not x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC for x in theClass.get_children())
    placementDelete = next((x for x in theClass.get_children() if x.spelling == "operator delete" and len(list(x.get_arguments())) == 2), None) is not None
    if nonPublicDestructor or placementDelete:
`

const correctedDestructorPolicy = `    nonPublicDestructor = any(x.kind == clang.cindex.CursorKind.DESTRUCTOR and not x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC for x in theClass.get_children())
    placementDelete = next((x for x in theClass.get_children() if x.spelling == "operator delete" and len(list(x.get_arguments())) == 2), None) is not None
    publicOrdinaryDelete = next((x for x in theClass.get_children() if x.spelling == "operator delete" and len(list(x.get_arguments())) == 1 and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC), None) is not None
    if nonPublicDestructor or (placementDelete and not publicOrdinaryDelete):
`

const archiveNames = {
  freetype: "freetype.tar.gz",
  occt: "occt.tar.gz",
  opencascadeJs: "opencascade-js.tar.gz",
  rapidjson: "rapidjson.tar.gz",
} as const

export type OcctBuilderSourceArchives = Record<keyof typeof archiveNames, string>

function replaceExactlyOnce(source: string, anchor: string, replacement: string) {
  const firstIndex = source.indexOf(anchor)

  if (firstIndex < 0 || firstIndex !== source.lastIndexOf(anchor)) {
    throw new Error("Expected exactly one OpenCascade.js destructor-policy anchor.")
  }

  return source.replace(anchor, replacement)
}

export function correctOpenCascadeJsDestructorPolicy(source: string) {
  return replaceExactlyOnce(source, upstreamDestructorPolicy, correctedDestructorPolicy)
}

export function createConfiguredBindingSymbols(buildConfig: string) {
  const symbols = Array.from(
    buildConfig.matchAll(/^\s*-\s+symbol:\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gm),
    (match) => match[1],
  ).filter((symbol): symbol is string => symbol !== undefined)

  if (symbols.length === 0) {
    throw new Error("The controlled OCCT build config does not declare any binding symbols.")
  }

  return Array.from(new Set(symbols)).sort()
}

function readArchiveEntry(archivePath: string, entry: string) {
  const result = spawnSync("tar", ["-xOf", archivePath, entry], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })

  if (result.error) {
    throw new Error(`Failed to read ${entry} from ${archivePath}: ${result.error.message}`)
  }

  if (result.status !== 0 || result.stdout.length === 0) {
    throw new Error(`Failed to read ${entry} from ${archivePath}: ${result.stderr.trim()}`)
  }

  return result.stdout
}

export function prepareOcctBuilderContext(options: {
  buildConfigPath: string
  configuredGeneratorPath: string
  contextDirectory: string
  dockerfilePath: string
  sourceArchives: OcctBuilderSourceArchives
}) {
  const {
    buildConfigPath,
    configuredGeneratorPath,
    contextDirectory,
    dockerfilePath,
    sourceArchives,
  } = options
  const contextSources = join(contextDirectory, "sources")
  const contextPatch = join(contextDirectory, "patches", "bindings.py")
  const configuredBindingsPath = join(contextDirectory, "config", "configured-bindings.txt")
  const contextGeneratorPath = join(contextDirectory, "scripts", "generate-configured-bindings.py")
  const sourceRevision = OCCT_BUILD_INPUTS.sources.opencascadeJs.revision
  const bindingEntry = `opencascade.js-${sourceRevision}/src/bindings.py`
  const upstreamBindings = readArchiveEntry(sourceArchives.opencascadeJs, bindingEntry)

  rmSync(contextDirectory, { force: true, recursive: true })
  mkdirSync(contextSources, { recursive: true })
  mkdirSync(join(contextDirectory, "patches"), { recursive: true })
  mkdirSync(join(contextDirectory, "config"), { recursive: true })
  mkdirSync(join(contextDirectory, "scripts"), { recursive: true })

  for (const [sourceName, archiveName] of Object.entries(archiveNames)) {
    copyFileSync(
      sourceArchives[sourceName as keyof OcctBuilderSourceArchives],
      join(contextSources, archiveName),
    )
  }

  copyFileSync(dockerfilePath, join(contextDirectory, "Dockerfile"))
  copyFileSync(configuredGeneratorPath, contextGeneratorPath)
  writeFileSync(contextPatch, correctOpenCascadeJsDestructorPolicy(upstreamBindings))
  writeFileSync(
    configuredBindingsPath,
    `${createConfiguredBindingSymbols(readFileSync(buildConfigPath, "utf8")).join("\n")}\n`,
  )

  const manifest = {
    schemaVersion: 1,
    emscriptenImage: OCCT_BUILD_INPUTS.sourceBuilder.emscriptenImage,
    pythonPackages: OCCT_BUILD_INPUTS.sourceBuilder.pythonPackages,
    sources: Object.fromEntries(
      Object.entries(archiveNames).map(([sourceName, archiveName]) => [
        sourceName,
        {
          file: archiveName,
          sha256: sha256(join(contextSources, archiveName)),
        },
      ]),
    ),
    dockerfile: {
      file: "Dockerfile",
      source: `native/occt/${basename(dockerfilePath)}`,
      sha256: sha256(join(contextDirectory, "Dockerfile")),
    },
    destructorPolicy: {
      sourceFile: bindingEntry,
      upstreamSha256: sha256Text(upstreamBindings),
      correctedFile: "patches/bindings.py",
      correctedSha256: sha256(contextPatch),
    },
    configuredBindings: {
      file: "config/configured-bindings.txt",
      sha256: sha256(configuredBindingsPath),
    },
    configuredGenerator: {
      file: "scripts/generate-configured-bindings.py",
      source: `native/occt/${basename(configuredGeneratorPath)}`,
      sha256: sha256(contextGeneratorPath),
    },
  }

  const manifestPath = join(contextDirectory, "manifest.json")
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { manifest, manifestPath }
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
