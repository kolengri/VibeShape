import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { publishMcpDescriptor, readMcpDescriptor } from "./mcp-descriptor"
import { createNativeSlicerApplications } from "./native-slicer-applications"
import { preparePrivateDirectory, readPrivateFile, writePrivateFile } from "./private-files"

const windows = process.platform === "win32"
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-private-files-"))
  roots.push(root)
  if (windows) {
    const privateRoot = join(root, "private")
    preparePrivateDirectory(privateRoot)
    return privateRoot
  }
  return root
}

// This mutates and independently inspects real Windows ACLs; it does not emulate Windows on POSIX.
function windowsAcl(path: string, operation: "inspect" | "expose") {
  const script = `
$ErrorActionPreference = 'Stop'
$path = [Environment]::GetEnvironmentVariable('VIBESHAPE_TEST_PRIVATE_PATH')
$acl = Get-Acl -LiteralPath $path
if ($env:VIBESHAPE_TEST_ACL_OPERATION -eq 'expose') {
  $everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($everyone, 'Read', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $path -AclObject $acl
} else {
  $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) |
    ForEach-Object { @{ sid = $_.IdentityReference.Value; allow = $_.AccessControlType.ToString() } })
  @{ owner = $owner; user = $user; protected = $acl.AreAccessRulesProtected; rules = $rules } |
    ConvertTo-Json -Compress -Depth 4
}
`
  return execFileSync(
    join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      env: {
        ...process.env,
        VIBESHAPE_TEST_PRIVATE_PATH: path,
        VIBESHAPE_TEST_ACL_OPERATION: operation,
      },
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    },
  )
}

describe("native private files", () => {
  it("creates a private directory and reads only bounded regular file bytes", async () => {
    const root = await directory()
    const privateDirectory = join(root, "native-workflows", "assistant")
    preparePrivateDirectory(privateDirectory)
    const path = join(privateDirectory, "private.json")
    await writePrivateFile(path, "private")
    expect((await readPrivateFile(path, 7)).toString()).toBe("private")
    await expect(writePrivateFile(path, "replacement")).rejects.toThrow()
    expect((await readPrivateFile(path, 7)).toString()).toBe("private")
    await expect(readPrivateFile(path, 6)).rejects.toThrow()
    await expect(readPrivateFile(privateDirectory, 16)).rejects.toThrow()
    await expect(readPrivateFile(path, 65537)).rejects.toThrow("size limit")
  }, 30_000)

  it("preserves remembered custom slicer identities across a host restart", async () => {
    const root = await directory()
    const executable = join(root, "Custom slicer.exe")
    await writeFile(executable, "fixture executable", { mode: 0o755 })
    const options = {
      directory: root,
      resolve: async () => null,
      inspect: async (path: string) =>
        path === executable ? { path, kind: "executable" as const } : null,
    }
    const chosen = await createNativeSlicerApplications(options).choose(executable)
    if (!chosen) throw new Error("Expected a remembered custom slicer.")
    expect(chosen?.id).toMatch(/^custom-/)
    expect(chosen?.name).toBe("Custom slicer")
    expect(await createNativeSlicerApplications(options).list()).toEqual([chosen])
    expect(
      (await readPrivateFile(join(root, "slicer-applications.json"), 65536)).length,
    ).toBeGreaterThan(0)
  }, 60_000)

  it.skipIf(windows)(
    "keeps POSIX directory ownership and 0700 policy, without following symlinks",
    async () => {
      const root = await directory()
      const target = join(root, "target")
      await mkdir(target, { mode: 0o755 })
      await chmod(target, 0o755)
      const link = join(root, "linked")
      await symlink(target, link)
      expect(() => preparePrivateDirectory(link)).toThrow()
      expect((await lstat(target)).mode & 0o777).toBe(0o755)
      preparePrivateDirectory(target)
      const details = await lstat(target)
      expect(details.mode & 0o777).toBe(0o700)
      if (process.getuid) expect(details.uid).toBe(process.getuid())
    },
  )

  it.skipIf(windows)("rejects POSIX group/world permissions and file symlinks", async () => {
    const root = await directory()
    const path = join(root, "private.json")
    await writeFile(path, "private", { mode: 0o600 })
    const link = join(root, "linked.json")
    await symlink(path, link)
    await expect(readPrivateFile(link, 16)).rejects.toThrow()
    await expect(writePrivateFile(link, "replacement")).rejects.toThrow()
    expect(await readFile(path, "utf8")).toBe("private")
    expect((await lstat(path)).mode & 0o777).toBe(0o600)
    for (const mode of [0o640, 0o604]) {
      await chmod(path, mode)
      await expect(readPrivateFile(path, 16)).rejects.toThrow("private file")
    }
    await chmod(path, 0o600)
    expect((await readPrivateFile(path, 16)).toString()).toBe("private")
  })

  it.skipIf(!windows)(
    "creates current-user Windows ownership and protected ACLs even with an elevated token's default owner",
    async () => {
      const root = await directory()
      const path = join(root, "private ' $([Environment]::Exit(23)) [record]")
      preparePrivateDirectory(path)
      const acl = JSON.parse(windowsAcl(path, "inspect"))
      expect(acl.owner).toBe(acl.user)
      expect(acl.protected).toBe(true)
      expect(acl.rules).toEqual([{ sid: acl.user, allow: "Allow" }])
      const record = join(path, "record.json")
      await writePrivateFile(record, "private")
      expect((await readPrivateFile(record, 16)).toString()).toBe("private")
      const inherited = JSON.parse(windowsAcl(record, "inspect"))
      expect(inherited.owner).toBe(inherited.user)
      expect(inherited.protected).toBe(true)
      expect(inherited.rules).toEqual([{ sid: inherited.user, allow: "Allow" }])
      // On elevated runners these ordinary creations can default to Administrators ownership.
      // Such existing objects must still be rejected, rather than silently reassigned.
      const ordinary = join(root, "ordinary.json")
      await writeFile(ordinary, "ordinary")
      const ordinaryAcl = JSON.parse(windowsAcl(ordinary, "inspect"))
      if (ordinaryAcl.owner !== ordinaryAcl.user) {
        await expect(readPrivateFile(ordinary, 16)).rejects.toThrow("private file")
        await expect(writePrivateFile(ordinary, "replacement")).rejects.toThrow()
        expect(await readFile(ordinary, "utf8")).toBe("ordinary")
        expect(JSON.parse(windowsAcl(ordinary, "inspect")).owner).toBe(ordinaryAcl.owner)
      }
      const existing = join(root, "ordinary-directory")
      await mkdir(existing)
      const existingAcl = windowsAcl(existing, "inspect")
      const inspected = JSON.parse(existingAcl)
      if (inspected.owner !== inspected.user) {
        expect(() => preparePrivateDirectory(existing)).toThrow("private directory")
        expect(windowsAcl(existing, "inspect")).toBe(existingAcl)
      }
    },
    60_000,
  )

  it.skipIf(!windows)(
    "refuses descriptors and remembered slicers with another principal's Windows access",
    async () => {
      const root = await directory()
      const path = join(root, "descriptor.json")
      const descriptor = {
        protocolVersion: 1 as const,
        endpoint: "http://127.0.0.1:43115/__vibeshape/native-mcp",
        token: "a".repeat(64),
        pid: process.pid,
      }
      const remove = await publishMcpDescriptor(path, descriptor)
      expect(await readMcpDescriptor(path)).toEqual(descriptor)
      windowsAcl(path, "expose")
      await expect(readMcpDescriptor(path)).rejects.toThrow("private file")
      await remove()
      const options = {
        directory: root,
        resolve: async () => null,
        inspect: async (application: string) => ({
          path: application,
          kind: "executable" as const,
        }),
      }
      const chosen = await createNativeSlicerApplications(options).choose(join(root, "Slicer.exe"))
      expect(chosen?.id).toMatch(/^custom-/)
      const registry = join(root, "slicer-applications.json")
      windowsAcl(registry, "expose")
      expect(await createNativeSlicerApplications(options).list()).toEqual([])
      expect((await readFile(registry)).length).toBeGreaterThan(0)
    },
    60_000,
  )

  it.skipIf(!windows)(
    "refuses Windows junctions instead of changing the target ACL",
    async () => {
      const root = await directory()
      const target = join(root, "target")
      await mkdir(target)
      const before = windowsAcl(target, "inspect")
      const link = join(root, "junction")
      await symlink(target, link, "junction")
      expect(() => preparePrivateDirectory(link)).toThrow("private directory")
      expect(windowsAcl(target, "inspect")).toBe(before)
      await expect(readPrivateFile(link, 16)).rejects.toThrow("private file")
      await expect(writePrivateFile(link, "replacement")).rejects.toThrow("private file")
      expect(windowsAcl(target, "inspect")).toBe(before)
    },
    60_000,
  )
})
