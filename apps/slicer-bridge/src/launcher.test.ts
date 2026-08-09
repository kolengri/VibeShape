import { describe, expect, it, vi } from "vitest"
import { launchSlicerFile, resolveSlicerExecutable, SlicerNotInstalledError } from "./launcher"

describe("slicer launcher", () => {
  it("resolves a configured absolute executable before platform candidates", async () => {
    const executable = await resolveSlicerExecutable({
      slicerId: "orca-slicer",
      platform: "linux",
      environment: {
        VIBESHAPE_SLICER_ORCA_SLICER: "/opt/orca/orca-slicer",
        PATH: "/usr/bin",
      },
      pathIsExecutable: async (path) => path === "/opt/orca/orca-slicer",
    })
    expect(executable).toBe("/opt/orca/orca-slicer")
  })

  it("launches the exact executable and file as separate no-shell arguments", async () => {
    const unref = vi.fn()
    const spawn = vi.fn(() => ({ unref }))
    await expect(
      launchSlicerFile({
        slicerId: "prusa-slicer",
        filePath: "/tmp/Bracket.3mf",
        platform: "linux",
        environment: { PATH: "/usr/local/bin:/usr/bin" },
        pathIsExecutable: async (path) => path === "/usr/local/bin/prusa-slicer",
        spawn,
      }),
    ).resolves.toMatchObject({
      slicerId: "prusa-slicer",
      executable: "/usr/local/bin/prusa-slicer",
    })
    expect(spawn).toHaveBeenCalledWith(["/usr/local/bin/prusa-slicer", "/tmp/Bracket.3mf"])
    expect(unref).toHaveBeenCalledOnce()
  })

  it("rejects relative overrides and reports an unavailable slicer", async () => {
    await expect(
      resolveSlicerExecutable({
        slicerId: "bambu-studio",
        platform: "linux",
        environment: { VIBESHAPE_SLICER_BAMBU_STUDIO: "./bambu-studio" },
      }),
    ).rejects.toThrow("must be an absolute path")
    await expect(
      launchSlicerFile({
        slicerId: "snapmaker-orca",
        filePath: "/tmp/Bracket.3mf",
        platform: "linux",
        environment: { PATH: "/usr/bin" },
        pathIsExecutable: async () => false,
        spawn: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(SlicerNotInstalledError)
  })
})
