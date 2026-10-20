import { afterEach, describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises"
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
async function fullCustomRegistry() {
  const root = await directory()
  const options = { directory: root, resolve: async () => null }
  const applications = createNativeSlicerApplications(options)
  const targets: { id: string; name: string }[] = []
  for (let index = 0; index < 16; index++) {
    const path = join(root, `Custom slicer ${index}`)
    await writeFile(path, "executable", { mode: 0o755 })
    const chosen = await applications.choose(path)
    if (!chosen) throw new Error("Expected a custom application to be registered.")
    targets.push(chosen)
  }
  return { root, options, targets }
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
  const root = overrides.directory ?? (await directory())
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
  it("keeps the 32-file disk limit across restart and recovers after user removal", async () => {
    const { root, host, launched } = await service()
    const firstResult = await host.send(request)
    for (let count = 1; count < 32; count++) expect((await host.send(request)).ok).toBe(true)
    expect(firstResult.ok).toBe(true)
    host.close()
    const base = join(root, "mesh-handoffs")
    const directories = await readdir(base)
    expect(directories).toHaveLength(32)
    const retainedTime = new Date(Date.now() - 18 * 60 * 60 * 1_000)
    for (const entry of directories) await utimes(join(base, entry), retainedTime, retainedTime)
    const restarted = await service({ directory: root })
    expect(await restarted.host.reveal(firstResult.fileId)).toBe(false)
    expect(await restarted.host.send(request)).toEqual({ ok: false, reason: "capacity" })
    expect(restarted.launched).toHaveLength(0)
    expect((await readdir(base)).sort()).toEqual(directories.sort())
    const first = launched[0]?.file
    if (!first) throw new Error("Expected retained files.")
    await rm(first)
    expect((await restarted.host.send(request)).ok).toBe(true)
    expect(restarted.launched).toHaveLength(1)
    restarted.host.close()
  })
  it("keeps the 512 MiB disk limit across restart until stale cleanup reclaims the file", async () => {
    const { root, host, launched } = await service()
    expect((await host.send(request)).ok).toBe(true)
    const file = launched[0]?.file
    if (!file) throw new Error("Expected a retained file.")
    await truncate(file, 512 * 1024 * 1024)
    const handoffDirectory = join(file, "..")
    const retainedTime = new Date(Date.now() - 18 * 60 * 60 * 1_000)
    await utimes(handoffDirectory, retainedTime, retainedTime)
    host.close()
    const restarted = await service({ directory: root })
    expect(await restarted.host.send(request)).toEqual({ ok: false, reason: "capacity" })
    expect(restarted.launched).toHaveLength(0)
    expect((await stat(file)).size).toBe(512 * 1024 * 1024)
    restarted.host.close()
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1_000)
    await utimes(handoffDirectory, staleTime, staleTime)
    const afterCleanup = await service({ directory: root })
    expect((await afterCleanup.host.send(request)).ok).toBe(true)
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" })
    expect(afterCleanup.launched).toHaveLength(1)
    afterCleanup.host.close()
  })
  it("does not free the disk budget when session Reveal IDs expire", async () => {
    let clock = Date.now()
    const { host, launched } = await service({ now: () => clock })
    const result = await host.send(request)
    expect(result.ok).toBe(true)
    const file = launched[0]?.file
    if (!file) throw new Error("Expected a retained file.")
    await truncate(file, 512 * 1024 * 1024)
    clock += 13 * 60 * 60 * 1_000
    expect(await host.reveal(result.fileId)).toBe(false)
    expect(await host.send(request)).toEqual({ ok: false, reason: "capacity" })
    expect((await stat(file)).size).toBe(512 * 1024 * 1024)
    host.close()
  })
  it("fails closed before persistence when the handoff directory cannot be inspected", async () => {
    const root = await directory()
    await writeFile(join(root, "mesh-handoffs"), "not a directory")
    let persisted = false
    const { host, launched } = await service({
      directory: root,
      files: {
        async persist() {
          persisted = true
          throw new Error("Unexpected file write")
        },
      },
    })
    expect(await host.send(request)).toEqual({ ok: false, reason: "unavailable" })
    expect(persisted).toBe(false)
    expect(launched).toHaveLength(0)
    host.close()
  })
})

describe("native application allowlist", () => {
  it("reclaims stale custom registrations before applying the limit after restart", async () => {
    const { root, options, targets } = await fullCustomRegistry()
    await rm(join(root, "Custom slicer 0"))
    await rename(join(root, "Custom slicer 1"), join(root, "Moved slicer"))
    await chmod(join(root, "Custom slicer 2"), 0o644)
    const restarted = createNativeSlicerApplications(options)
    expect(await restarted.list()).toEqual(targets.slice(3))
    const replacement = join(root, "Replacement slicer")
    await writeFile(replacement, "executable", { mode: 0o755 })
    const chosen = await restarted.choose(replacement)
    expect(chosen?.id).toMatch(/^custom-/)
    if (!chosen) throw new Error("Expected a replacement custom application.")
    const expected = [...targets.slice(3), chosen]
    expect(await createNativeSlicerApplications(options).list()).toEqual(expected)
    const saved = JSON.parse(await readFile(join(root, "slicer-applications.json"), "utf8"))
    expect(saved).toHaveLength(14)
    expect(saved).toEqual(expected.map((target) => expect.objectContaining(target)))
    for (const stale of targets.slice(0, 3)) expect(await restarted.resolve(stale.id)).toBeNull()
    expect((await stat(join(root, "slicer-applications.json"))).mode & 0o777).toBe(0o600)
  })
  it("preserves the full valid custom registry and existing IDs when a new selection exceeds the limit", async () => {
    const { root, options, targets } = await fullCustomRegistry()
    const registry = join(root, "slicer-applications.json")
    const before = await readFile(registry)
    const candidate = join(root, "One more slicer")
    await writeFile(candidate, "executable", { mode: 0o755 })
    const restarted = createNativeSlicerApplications(options)
    expect(await restarted.choose(candidate)).toBeNull()
    const first = targets[0]
    if (!first) throw new Error("Expected the first registered application.")
    expect(await restarted.choose(join(root, "Custom slicer 0"))).toEqual(first)
    expect(await restarted.list()).toEqual(targets)
    expect(await readFile(registry)).toEqual(before)
  })
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
    await launchNativeSlicer(
      {
        id: "bambu-studio",
        name: "Bambu Studio",
        kind: "bundle",
        path: "/Applications/BambuStudio.app",
      },
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
    expect(calls[2]?.command).toBe("/usr/bin/open")
    expect(calls[2]?.args).toEqual(["-a", "/Applications/BambuStudio.app", file])
  })
})
