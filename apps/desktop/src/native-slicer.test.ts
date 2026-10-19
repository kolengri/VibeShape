import { afterEach, describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNativeSlicerService } from "./native-slicer"
import { createNativeSlicerApplications } from "./native-slicer-applications"
import { launchNativeSlicer } from "./native-slicer-launcher"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-native-slicer-"))
  roots.push(root)
  return root
}
const request = {
  slicerId: "orca-slicer",
  format: "3mf",
  filename: "Bracket.3mf",
  file: new Uint8Array([80, 75, 3, 4]),
} as const
const target = {
  id: "orca-slicer",
  name: "OrcaSlicer",
  kind: "bundle",
  path: "/Applications/OrcaSlicer.app",
} as const

async function service(overrides: Partial<Parameters<typeof createNativeSlicerService>[0]> = {}) {
  const root = await directory()
  const launched: { application: unknown; file: string }[] = []
  const revealed: string[] = []
  const host = createNativeSlicerService({
    directory: root,
    applications: {
      async list() {
        return [{ id: target.id, name: target.name }]
      },
      async choose() {
        return null
      },
      async resolve(id) {
        return id === target.id ? target : null
      },
    },
    async chooseApplication() {
      return null
    },
    reveal: (path) => {
      revealed.push(path)
    },
    async launch(application, file) {
      launched.push({ application, file })
    },
    ...overrides,
  })
  return { root, host, launched, revealed }
}

describe("native slicer handoff", () => {
  it("persists private bytes, sends only a host-resolved app and reveals by opaque ID", async () => {
    const { host, launched, revealed } = await service()
    const result = await host.send(request)
    expect(result).toMatchObject({ ok: true, slicerName: "OrcaSlicer" })
    if (!result.ok) throw new Error("Expected a native handoff.")
    const file = launched[0]?.file
    if (!file) throw new Error("Expected one launch.")
    expect(await readFile(file)).toEqual(Buffer.from(request.file))
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await stat(join(file, ".."))).mode & 0o777).toBe(0o700)
    expect(await host.reveal(file)).toBe(false)
    expect(await host.reveal("00000000-0000-4000-8000-000000000000")).toBe(false)
    expect(await host.reveal(result.fileId)).toBe(true)
    expect(revealed).toEqual([file])
    host.close()
    expect(await host.reveal(result.fileId)).toBe(false)
  })
  it("rejects malformed metadata and unknown application IDs before writing or launching", async () => {
    const { host, launched } = await service({
      files: {
        async persist() {
          throw new Error("Unexpected file write")
        },
      },
    })
    for (const payload of [
      { ...request, filename: "../Bracket.3mf" },
      { ...request, format: "stl" },
      { ...request, file: new Uint8Array() },
      { ...request, path: "/Applications/Other.app" },
    ])
      expect(await host.send(payload)).toEqual({ ok: false, reason: "invalid-request" })
    expect(
      await host.send({ ...request, slicerId: "custom-00000000-0000-4000-8000-000000000000" }),
    ).toEqual({ ok: false, reason: "not-installed" })
    expect(launched).toEqual([])
  })
  it("keeps failed-launch meshes available and releases the single-flight lock", async () => {
    let fail: ((error: Error) => void) | undefined
    const { host } = await service({
      launch: () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject
        }),
    })
    const pending = host.send(request)
    while (!fail) await new Promise((resolve) => setTimeout(resolve, 1))
    expect(await host.send(request)).toEqual({ ok: false, reason: "busy" })
    expect(await host.chooseApplication()).toEqual({ ok: false, reason: "busy" })
    fail(new Error("Private launcher diagnostic"))
    const result = await pending
    expect(result).toMatchObject({ ok: false, reason: "launch-failed" })
    if (!result.fileId) throw new Error("Expected a retained mesh ID.")
    expect(await host.reveal(result.fileId)).toBe(true)
    host.close()
    expect(await host.send(request)).toEqual({ ok: false, reason: "unavailable" })
  })
  it("classifies write failure without launching an application", async () => {
    const { host, launched } = await service({
      files: {
        async persist() {
          throw new Error("Private filesystem diagnostic")
        },
      },
    })
    expect(await host.send(request)).toEqual({ ok: false, reason: "write-failed" })
    expect(launched).toHaveLength(0)
  })
  it("retains only a bounded set of meshes and recognizes files removed by the user", async () => {
    const { host, launched } = await service()
    for (let count = 0; count < 32; count++) expect((await host.send(request)).ok).toBe(true)
    expect(await host.send(request)).toEqual({ ok: false, reason: "capacity" })
    const first = launched[0]?.file
    if (!first) throw new Error("Expected retained files.")
    await rm(first)
    expect((await host.send(request)).ok).toBe(true)
  })
})

describe("native application allowlist", () => {
  it("discovers installed bundles and remembers only applications selected through the host", async () => {
    const root = await directory()
    const bundle = join(root, "OrcaSlicer.app")
    const executable = join(bundle, "Contents/MacOS/OrcaSlicer")
    await mkdir(join(bundle, "Contents/MacOS"), { recursive: true })
    await writeFile(join(bundle, "Contents/Info.plist"), "plist")
    await writeFile(executable, "executable", { mode: 0o755 })
    const options = {
      directory: root,
      resolve: async ({ slicerId }: { slicerId: string }) =>
        slicerId === "orca-slicer" ? executable : null,
    }
    const applications = createNativeSlicerApplications(options)
    expect(await applications.list()).toEqual([{ id: "orca-slicer", name: "OrcaSlicer" }])
    const custom = join(root, "Custom slicer")
    await writeFile(custom, "executable", { mode: 0o755 })
    const chosen = await applications.choose(custom)
    expect(chosen?.id).toMatch(/^custom-/)
    expect((await stat(join(root, "slicer-applications.json"))).mode & 0o777).toBe(0o600)
    expect(await applications.choose(custom)).toEqual(chosen)
    expect(await createNativeSlicerApplications(options).list()).toEqual(
      expect.arrayContaining([chosen]),
    )
    await chmod(custom, 0o644)
    expect(await applications.resolve(chosen?.id ?? "")).toBeNull()
    expect(await applications.choose(join(root, "missing"))).toBeNull()
  })
  it("uses argv-only Mac open or executable launch and strips Electron Node mode", async () => {
    const calls: {
      command: string
      args: readonly string[]
      env: NodeJS.ProcessEnv | undefined
    }[] = []
    const start = (
      command: string,
      args: readonly string[],
      options: Parameters<typeof spawn>[2],
    ) => {
      calls.push({ command, args, env: options?.env })
      return spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" })
    }
    const file = "/private/mesh; harmless.3mf"
    await launchNativeSlicer(target, file, {
      spawn: start,
      env: { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin:/bin" },
    })
    await launchNativeSlicer(
      { ...target, kind: "executable", path: "/private/Custom slicer" },
      file,
      { spawn: start },
    )
    expect(calls[0]).toEqual({
      command: "/usr/bin/open",
      args: ["-a", target.path, file],
      env: { PATH: "/usr/bin:/bin" },
    })
    expect(calls[1]?.args).toEqual([file])
    expect(calls[1]?.command).toBe("/private/Custom slicer")
  })
})
