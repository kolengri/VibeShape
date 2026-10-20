import { describe, expect, it } from "bun:test"
import { resolveSlicerExecutable } from "./resolver"

describe("macOS slicer discovery", () => {
  for (const root of ["/Applications", "/Users/test/Applications"])
    it(`discovers Snapmaker Orca's installed executable under ${root}`, async () => {
      const executable = `${root}/Snapmaker Orca.app/Contents/MacOS/Snapmaker_Orca`
      expect(
        await resolveSlicerExecutable({
          slicerId: "snapmaker-orca",
          platform: "darwin",
          home: "/Users/test",
          environment: { PATH: "" },
          pathIsExecutable: async (path) => path === executable,
        }),
      ).toBe(executable)
    })

  for (const root of ["/Applications", "/Users/test/Applications"])
    it(`discovers PrusaSlicer in its driver bundle under ${root}`, async () => {
      const executable = `${root}/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`
      expect(
        await resolveSlicerExecutable({
          slicerId: "prusa-slicer",
          platform: "darwin",
          home: "/Users/test",
          environment: { PATH: "" },
          pathIsExecutable: async (path) => path === executable,
        }),
      ).toBe(executable)
    })

  for (const root of ["/Applications", "/Users/test/Applications"])
    it(`preserves an already discovered PrusaSlicer installation under ${root}`, async () => {
      const executable = `${root}/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`
      expect(
        await resolveSlicerExecutable({
          slicerId: "prusa-slicer",
          platform: "darwin",
          home: "/Users/test",
          environment: { PATH: "" },
          pathIsExecutable: async (path) =>
            path === executable ||
            path ===
              "/Applications/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer",
        }),
      ).toBe(executable)
    })

  it("retains the existing Snapmaker executable fallback", async () => {
    const executable = "/Applications/Snapmaker Orca.app/Contents/MacOS/Snapmaker Orca"
    expect(
      await resolveSlicerExecutable({
        slicerId: "snapmaker-orca",
        platform: "darwin",
        environment: { PATH: "" },
        pathIsExecutable: async (path) => path === executable,
      }),
    ).toBe(executable)
  })
})
