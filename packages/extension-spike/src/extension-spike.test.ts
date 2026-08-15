import { strToU8 } from "fflate"
import { isFunction } from "is-what"
import { describe, expect, it } from "vitest"
import {
  buildExtensionArchive,
  extensionFixture,
  scalarFeatureWasm,
  undeclaredImportWasm,
} from "./fixtures"
import { sha256Bytes } from "./hash"
import {
  CapabilityCoordinator,
  compareUpdateInvariant,
  extensionLock,
  ImmutableExtensionStore,
  isExtensionApiCompatible,
  preserveRestrictedFeaturePayload,
  previewCapabilityUpdate,
  resolveExtensionState,
} from "./host"
import { validateExtensionPackage } from "./package"
import {
  createPublisherKeyPair,
  packageTrust,
  signManifest,
  verifyPackageSignature,
} from "./signature"

async function requirePackage(bytes: Uint8Array) {
  const result = await validateExtensionPackage(bytes)
  if (!result.ok) throw new Error(`${result.diagnostic.code}: ${result.diagnostic.message}`)
  return result.value
}

async function customArchive(files: Record<string, Uint8Array>, manifestChanges = {}) {
  const checksums = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, bytes]) => [name, await sha256Bytes(bytes)]),
    ),
  )
  return buildExtensionArchive({
    manifest: {
      schemaVersion: 1,
      id: "org.example.hostile",
      name: "Hostile fixture",
      version: "1.0.0",
      apiVersion: "1.0",
      license: "GPL-3.0-or-later",
      entrypoints: { feature: "feature/main.wasm" },
      capabilities: [],
      files: checksums,
      ...manifestChanges,
    },
    files,
  })
}

function markFirstCentralEntryAsSymlink(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes)
  const view = new DataView(copy.buffer)
  for (let offset = 0; offset <= copy.byteLength - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x0201_4b50) continue
    view.setUint16(offset + 4, 0x0314, true)
    view.setUint32(offset + 38, 0xa1ff_0000, true)
    return copy
  }
  throw new Error("The ZIP central directory fixture is missing.")
}

describe("extension package and runtime candidates", () => {
  it("creates deterministic immutable archives and executable scalar WASM", async () => {
    const first = await extensionFixture({ version: "1.0.0", multiplier: 2 })
    const second = await extensionFixture({ version: "1.0.0", multiplier: 2 })
    expect(first.archive).toEqual(second.archive)
    const installed = await requirePackage(first.archive)
    expect(installed.manifest.id).toBe("org.example.threaded-insert")
    const instance = await WebAssembly.instantiate(scalarFeatureWasm(2))
    const evaluate = Reflect.get(instance.instance.exports, "evaluate")
    if (!isFunction(evaluate)) throw new Error("The scalar fixture export is missing.")
    expect(Reflect.apply(evaluate, undefined, [21])).toBe(42)
  })

  it("exposes undeclared WASM imports for host rejection", async () => {
    const module = await WebAssembly.compile(undeclaredImportWasm())
    expect(WebAssembly.Module.imports(module)).toEqual([
      { kind: "function", module: "env", name: "fetch" },
    ])
  })

  it("rejects hostile paths, collisions, symlinks, limits, and checksums", async () => {
    const license = strToU8("GPL-3.0-or-later")
    const wasm = scalarFeatureWasm(2)
    const traversal = await customArchive({
      LICENSE: license,
      "feature/main.wasm": wasm,
      "../evil.js": strToU8("x"),
    })
    await expect(validateExtensionPackage(traversal)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "unsafe-path" },
    })

    const collision = await customArchive({
      LICENSE: license,
      "feature/main.wasm": wasm,
      "Feature/Main.wasm": wasm,
    })
    await expect(validateExtensionPackage(collision)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "unsafe-path" },
    })

    const base = await customArchive({ LICENSE: license, "feature/main.wasm": wasm })
    await expect(
      validateExtensionPackage(markFirstCentralEntryAsSymlink(base)),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "unsafe-path" },
    })

    const oversized = await customArchive({
      LICENSE: license,
      "feature/main.wasm": wasm,
      "assets/oversized.bin": new Uint8Array(513 * 1024),
    })
    await expect(validateExtensionPackage(oversized)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "resource-limit" },
    })

    const fixture = await extensionFixture({ version: "1.0.0", multiplier: 2 })
    const checksumMismatch = await buildExtensionArchive({
      manifest: {
        ...fixture.manifest,
        files: { ...fixture.manifest.files, "feature/main.wasm": "0".repeat(64) },
      },
      files: fixture.files,
    })
    await expect(validateExtensionPackage(checksumMismatch)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "integrity-mismatch" },
    })
  })

  it("keeps signatures as publisher identity rather than sandbox bypass", async () => {
    const unsignedFixture = await extensionFixture({ version: "1.0.0", multiplier: 2 })
    const unsignedPackage = await requirePackage(unsignedFixture.archive)
    const keyPair = await createPublisherKeyPair()
    const signature = await signManifest(unsignedPackage.manifestBytes, keyPair)
    const signedFixture = await extensionFixture({
      version: "1.0.0",
      multiplier: 2,
      signature,
    })
    const signedPackage = await requirePackage(signedFixture.archive)
    await expect(verifyPackageSignature(signedPackage, keyPair.publicKey)).resolves.toBe(true)
    expect(packageTrust(null)).toEqual({ identity: "unknown-publisher", sandboxRequired: true })
    expect(packageTrust(true)).toEqual({ identity: "verified-publisher", sandboxRequired: true })
  })
})

describe("extension host policy", () => {
  it("revokes active hosts without residual capability authority", () => {
    const coordinator = new CapabilityCoordinator(["model.read", "network.connect"])
    expect(coordinator.authorize("network.connect")).toBe(false)
    expect(coordinator.grant("network.connect")).toBe(true)
    let terminated = 0
    expect(
      coordinator.registerHost("host-1", ["network.connect"], () => {
        terminated += 1
      }),
    ).toBe(true)
    expect(coordinator.revoke("network.connect")).toBe(1)
    expect(terminated).toBe(1)
    expect(coordinator.authorize("network.connect")).toBe(false)
  })

  it("supports exact-version coexistence and rejects identity substitution", async () => {
    const versionOne = await requirePackage(
      (await extensionFixture({ version: "1.0.0", multiplier: 2 })).archive,
    )
    const versionTwo = await requirePackage(
      (await extensionFixture({ version: "2.0.0", multiplier: 3 })).archive,
    )
    const conflictingVersionOne = await requirePackage(
      (await extensionFixture({ version: "1.0.0", multiplier: 4 })).archive,
    )
    const store = new ImmutableExtensionStore()
    expect(store.install(versionOne)).toEqual({ ok: true })
    expect(store.install(versionTwo)).toEqual({ ok: true })
    expect(store.resolve(extensionLock(versionOne))?.integrity).toBe(versionOne.integrity)
    expect(store.resolve(extensionLock(versionTwo))?.integrity).toBe(versionTwo.integrity)
    expect(store.install(conflictingVersionOne)).toEqual({
      ok: false,
      code: "identity-integrity-conflict",
    })
  })

  it("defines compatibility, update, rollback, and restricted-mode outcomes", () => {
    expect(isExtensionApiCompatible("1.0", "1.0")).toBe(true)
    expect(isExtensionApiCompatible("1.0", "1.1")).toBe(true)
    expect(isExtensionApiCompatible("1.1", "1.0")).toBe(false)
    expect(isExtensionApiCompatible("1.0", "2.0")).toBe(false)
    expect(previewCapabilityUpdate(["model.read"], ["model.read", "network.connect"])).toEqual({
      added: ["network.connect"],
      requiresApproval: true,
      enabledAfterUpdate: false,
    })
    expect(compareUpdateInvariant(42, 63)).toEqual({ matches: false, current: 42, candidate: 63 })
    expect(resolveExtensionState({ installed: false, enabled: false, compatible: false })).toBe(
      "extension-missing",
    )
    expect(resolveExtensionState({ installed: true, enabled: false, compatible: true })).toBe(
      "extension-disabled",
    )
    expect(resolveExtensionState({ installed: true, enabled: true, compatible: false })).toBe(
      "extension-incompatible",
    )
    expect(
      resolveExtensionState({
        installed: true,
        enabled: true,
        compatible: true,
        runtimeFailure: "extension-timeout",
      }),
    ).toBe("extension-timeout")
    expect(preserveRestrictedFeaturePayload({ unknown: { value: 42 } })).toEqual({
      ok: true,
      serialized: '{"unknown":{"value":42}}',
    })
  })
})
