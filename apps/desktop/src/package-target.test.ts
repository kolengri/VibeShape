import { describe, expect, test } from "bun:test"
import { packageTarget } from "../package-target"
import { desktopArtifactName } from "./desktop-platform"

describe("desktop package targets", () => {
  test("keeps the Mac positional command compatible", () => {
    expect(packageTarget(["/out", "x64", "/kernel"], "darwin", "arm64")).toEqual({
      destination: "/out",
      arch: "x64",
      bundle: "/kernel",
      platform: "darwin",
    })
  })
  test("defaults Windows to x64 even on an Apple Silicon packaging host", () => {
    expect(packageTarget(["--windows", "/out"], "darwin", "arm64")).toEqual({
      destination: "/out",
      arch: "x64",
      bundle: undefined,
      platform: "win32",
    })
    expect(packageTarget(["C:\\output"], "win32", "x64").platform).toBe("win32")
  })
  test("refuses unsupported Windows architectures and Mac packaging hosts", () => {
    expect(() => packageTarget(["--windows", "/out", "arm64"], "darwin", "arm64")).toThrow(
      "x64 only",
    )
    expect(() => packageTarget(["/out"], "linux", "x64")).toThrow()
    expect(() => packageTarget(["--windows", "/out"], "linux", "x64")).toThrow()
  })
  test("uses distinct release artifacts for each supported target", () => {
    expect(desktopArtifactName("1.2.3", "x64", "win32")).toBe("VibeShape-1.2.3-win-x64.zip")
    expect(desktopArtifactName("1.2.3", "x64", "darwin")).toBe("VibeShape-1.2.3-mac-x64.dmg")
    expect(() => desktopArtifactName("1.2.3", "arm64", "win32")).toThrow()
  })
})
