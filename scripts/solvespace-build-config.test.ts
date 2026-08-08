import { describe, expect, test } from "vitest"
import { assertLocalSolveSpaceBuild, SOLVESPACE_BUILD_INPUTS } from "./solvespace-build-config"

describe("SolveSpace build configuration", () => {
  test("pins every source and the builder image by digest", () => {
    expect(SOLVESPACE_BUILD_INPUTS.builderImage).toMatch(/@sha256:[a-f0-9]{64}$/)
    expect(SOLVESPACE_BUILD_INPUTS.sources.solvespace.release).toBe("v3.2")

    for (const source of Object.values(SOLVESPACE_BUILD_INPUTS.sources)) {
      expect(source.revision).toMatch(/^[a-f0-9]{40}$/)
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(source.url).toMatch(/^https:\/\//)
    }
  })

  test("rejects expensive source builds in CI", () => {
    expect(() => assertLocalSolveSpaceBuild({ CI: "true" })).toThrow(/local-only/)
    expect(() => assertLocalSolveSpaceBuild({ CI: "1" })).toThrow(/local-only/)
    expect(() => assertLocalSolveSpaceBuild({ CI: "false" })).not.toThrow()
    expect(() => assertLocalSolveSpaceBuild({})).not.toThrow()
  })
})
