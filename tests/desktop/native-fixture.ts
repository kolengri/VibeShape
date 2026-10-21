import type { ChildProcess } from "node:child_process"
import { once } from "node:events"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, type ElectronApplication, expect } from "@playwright/test"
import { z } from "zod"

export const nativeTestRoot = resolve(import.meta.dirname, "../..")
const require = createRequire(join(nativeTestRoot, "apps/desktop/package.json"))
export const nativeElectronExecutable = z.string().parse(require("electron"))

async function isolatedOrigin() {
  const reserve = createServer()
  reserve.listen(0, "127.0.0.1")
  await once(reserve, "listening")
  const address = reserve.address()
  if (!address || typeof address === "string") throw new Error("Missing isolated native test port.")
  await new Promise<void>((done) => reserve.close(() => done()))
  return `http://127.0.0.1:${address.port}`
}

export async function createNativeFixture(
  options: { directory?: string; bootstrap?: string; packagedApp?: string } = {},
) {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), "vibeshape-native-test-")))
  const profileContainer = join(directory, "profile")
  const profile =
    process.platform === "win32" ? join(profileContainer, "User Data") : profileContainer
  const packagedApp = options.bootstrap
    ? undefined
    : (options.packagedApp ?? process.env.VIBESHAPE_PACKAGED_APP)
  const executablePath = packagedApp
    ? join(
        resolve(packagedApp),
        process.platform === "win32" ? "VibeShape.exe" : "Contents/MacOS/VibeShape",
      )
    : nativeElectronExecutable
  const origin = packagedApp ? "http://127.0.0.1:43115" : await isolatedOrigin()
  const applications = new Map<ElectronApplication, ChildProcess>()
  if (options.bootstrap) {
    const desktopPackage = z
      .object({ version: z.string() })
      .parse(JSON.parse(await readFile(join(nativeTestRoot, "apps/desktop/package.json"), "utf8")))
    await mkdir(join(directory, "dist"), { recursive: true })
    for (const name of ["preload.cjs", "mcp.cjs"])
      await cp(join(nativeTestRoot, "apps/desktop/dist", name), join(directory, "dist", name))
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "native-acceptance-fixture",
        version: desktopPackage.version,
        main: "bootstrap.cjs",
      }),
    )
    await writeFile(join(directory, "bootstrap.cjs"), options.bootstrap)
  }
  return {
    directory,
    profile,
    origin,
    packaged: Boolean(packagedApp),
    executablePath,
    async launch() {
      const environment = z
        .record(z.string(), z.string())
        .parse({ ...process.env, ELECTRON_ENABLE_SECURITY_WARNINGS: "true" })
      delete environment.ELECTRON_RUN_AS_NODE
      if (packagedApp) {
        delete environment.VIBESHAPE_DESKTOP_TEST_PORT
        delete environment.VIBESHAPE_DESKTOP_EDITOR
        if (process.platform !== "win32") environment.PATH = "/usr/bin:/bin"
      } else {
        environment.VIBESHAPE_DESKTOP_TEST_PORT = new URL(origin).port
        environment.VIBESHAPE_DESKTOP_EDITOR = join(nativeTestRoot, "apps/web/dist")
      }
      const application = options.bootstrap ? directory : join(nativeTestRoot, "apps/desktop")
      const native = await _electron.launch({
        executablePath,
        args: [...(packagedApp ? [] : [application]), `--user-data-dir=${profileContainer}`],
        env: environment,
      })
      applications.set(native, native.process())
      return native
    },
    async cleanup() {
      for (const [native, child] of applications) if (child.exitCode === null) await native.close()
      if (!options.directory) await rm(directory, { recursive: true, force: true })
    },
  }
}

export async function openNativeEditor(
  native: ElectronApplication,
  options: { projectName?: string } = {},
) {
  const page = await native.firstWindow()
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  const chooser = page.getByRole("heading", { level: 1, name: "Projects", exact: true })
  await expect(chooser.or(viewport)).toBeVisible()
  if (await chooser.isVisible()) {
    if (options.projectName) {
      await page
        .getByRole("button", { name: /^Open / })
        .filter({ has: page.getByText(options.projectName, { exact: true }) })
        .click()
    } else await page.getByRole("button", { name: "New project", exact: true }).click()
  }
  await expect(viewport).toBeVisible()
  await expect(page.getByRole("status", { name: "Project save status", exact: true })).toHaveText(
    "Saved",
  )
  return page
}
