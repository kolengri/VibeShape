import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initializeDesktopProfile } from "./startup-profile"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function directory() {
  const root = mkdtempSync(join(tmpdir(), "vibeshape-profile-startup-"))
  directories.push(root)
  return root
}
function host() {
  const configured: string[] = []
  const dialogs: { title: string; content: string }[] = []
  return {
    configured,
    dialogs,
    options: {
      packaged: true,
      setUserDataPath(path: string) {
        expect(existsSync(path)).toBe(true)
        configured.push(path)
      },
      showErrorBox(title: string, content: string) {
        dialogs.push({ title, content })
      },
    },
  }
}
function startupFailure(dialogs: ReturnType<typeof host>["dialogs"], path: string) {
  expect(dialogs).toEqual([
    {
      title: "VibeShape could not start",
      content:
        "The local editor could not be started. Quit VibeShape and open it again. If the problem continues, reinstall the app.",
    },
  ])
  expect(dialogs[0]?.content).not.toContain(path)
}

describe("early native profile startup", () => {
  it("creates the selected profile synchronously before configuring Electron userData", () => {
    const path = join(directory(), "Application Support", "VibeShape")
    const context = host()
    expect(initializeDesktopProfile(path, context.options)).toBe(true)
    expect(context.configured).toEqual([path])
    expect(context.dialogs).toEqual([])
  })
  it("reports a blocked Finder-style default profile through catalog copy and refuses startup", () => {
    const root = directory()
    writeFileSync(join(root, "Application Support"), "Blocked directory")
    const path = join(root, "Application Support", "VibeShape")
    const context = host()
    expect(initializeDesktopProfile(path, context.options)).toBe(false)
    expect(context.configured).toEqual([])
    startupFailure(context.dialogs, path)
  })
  it("refuses an inaccessible explicit user-data-dir without configuring a fallback profile", () => {
    const path = join(directory(), "requested-profile")
    writeFileSync(path, "Existing file")
    const context = host()
    expect(initializeDesktopProfile(path, context.options)).toBe(false)
    expect(context.configured).toEqual([])
    startupFailure(context.dialogs, path)
  })
  it("also reports Electron path configuration errors without exposing their diagnostic", () => {
    const path = join(directory(), "requested-profile")
    const context = host()
    expect(
      initializeDesktopProfile(path, {
        ...context.options,
        setUserDataPath() {
          throw new Error(`EACCES ${path}`)
        },
      }),
    ).toBe(false)
    startupFailure(context.dialogs, path)
  })
})
