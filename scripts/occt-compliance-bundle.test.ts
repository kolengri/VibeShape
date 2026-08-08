import { describe, expect, it } from "vitest"
import {
  assertLocalOcctComplianceEnvironment,
  OCCT_COMPLIANCE_BUNDLE_NAME,
  occtComplianceManifestSchema,
} from "./occt-compliance-bundle"
import { OCCT_BUILD_INPUTS } from "./occt-build-config"

const digest = "a".repeat(64)

function createSource(sourceName: keyof typeof OCCT_BUILD_INPUTS.sources, path: string) {
  return {
    ...OCCT_BUILD_INPUTS.sources[sourceName],
    path,
  }
}

function createManifest() {
  return {
    schemaVersion: 1,
    bundle: {
      name: OCCT_COMPLIANCE_BUNDLE_NAME,
      purpose: "VibeShape controlled OCCT corresponding-source bundle",
      opencascadeRevision: OCCT_BUILD_INPUTS.sources.occt.revision,
      opencascadeJsRevision: OCCT_BUILD_INPUTS.sources.opencascadeJs.revision,
    },
    toolchain: {
      platform: OCCT_BUILD_INPUTS.platform,
      emscriptenImage: OCCT_BUILD_INPUTS.sourceBuilder.emscriptenImage,
      pythonPackages: [...OCCT_BUILD_INPUTS.sourceBuilder.pythonPackages],
    },
    sources: {
      freetype: createSource("freetype", "build/context/sources/freetype.tar.gz"),
      occt: createSource("occt", "build/context/sources/occt.tar.gz"),
      opencascadeJs: createSource("opencascadeJs", "build/context/sources/opencascade-js.tar.gz"),
      rapidjson: createSource("rapidjson", "build/context/sources/rapidjson.tar.gz"),
      replicad: createSource("replicad", "build/context/sources/replicad.tar.gz"),
    },
    modifications: [{ path: "build/context/patches/bindings.py", sha256: digest }],
    files: [{ path: "README.md", bytes: 1, sha256: digest }],
  } as const
}

describe("OCCT compliance bundle contract", () => {
  it("accepts a strict normalized manifest", () => {
    expect(occtComplianceManifestSchema.parse(createManifest()).schemaVersion).toBe(1)
    expect(
      occtComplianceManifestSchema.safeParse({ ...createManifest(), unexpected: true }).success,
    ).toBe(false)
  })

  it("rejects traversal and duplicate inventory paths", () => {
    const manifest = createManifest()

    expect(
      occtComplianceManifestSchema.safeParse({
        ...manifest,
        files: [{ path: "../README.md", bytes: 1, sha256: digest }],
      }).success,
    ).toBe(false)
    expect(
      occtComplianceManifestSchema.safeParse({
        ...manifest,
        files: [manifest.files[0], manifest.files[0]],
      }).success,
    ).toBe(false)
  })

  it("rejects CI before reading or copying compliance inputs", () => {
    expect(() => assertLocalOcctComplianceEnvironment({ CI: "true" })).toThrow(
      "OCCT compliance bundle generation is local-only",
    )
    expect(() => assertLocalOcctComplianceEnvironment({})).not.toThrow()
  })
})
