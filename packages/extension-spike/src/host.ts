import { isError } from "is-what"
import type { ValidatedExtensionPackage } from "./package"
import {
  type ExtensionCapability,
  type ExtensionFailureState,
  type ExtensionLock,
  extensionApiVersionSchema,
  extensionCapabilitySchema,
  extensionLockSchema,
} from "./schemas"

interface ActiveCapabilityHost {
  capabilities: ReadonlySet<ExtensionCapability>
  terminate: () => void
}

export class CapabilityCoordinator {
  readonly declared: ReadonlySet<ExtensionCapability>
  readonly granted = new Set<ExtensionCapability>()
  readonly activeHosts = new Map<string, ActiveCapabilityHost>()

  constructor(capabilities: readonly ExtensionCapability[]) {
    this.declared = new Set(capabilities)
  }

  grant(capabilityInput: unknown) {
    const capability = extensionCapabilitySchema.safeParse(capabilityInput)
    if (!capability.success || !this.declared.has(capability.data)) return false
    this.granted.add(capability.data)
    return true
  }

  authorize(capabilityInput: unknown) {
    const capability = extensionCapabilitySchema.safeParse(capabilityInput)
    return capability.success && this.granted.has(capability.data)
  }

  registerHost(
    hostId: string,
    capabilities: readonly ExtensionCapability[],
    terminate: () => void,
  ) {
    const allowed = capabilities.every((capability) => this.authorize(capability))
    if (!allowed || this.activeHosts.has(hostId)) return false
    this.activeHosts.set(hostId, { capabilities: new Set(capabilities), terminate })
    return true
  }

  revoke(capabilityInput: unknown) {
    const capability = extensionCapabilitySchema.safeParse(capabilityInput)
    if (!capability.success) return 0
    this.granted.delete(capability.data)
    let terminated = 0
    for (const [hostId, host] of this.activeHosts) {
      if (!host.capabilities.has(capability.data)) continue
      host.terminate()
      this.activeHosts.delete(hostId)
      terminated += 1
    }
    return terminated
  }
}

function protocolParts(version: string) {
  const parsed = extensionApiVersionSchema.parse(version)
  const [major, minor] = parsed.split(".").map(Number)
  return { major: major ?? -1, minor: minor ?? -1 }
}

export function isExtensionApiCompatible(requiredVersion: string, hostVersion: string) {
  try {
    const required = protocolParts(requiredVersion)
    const host = protocolParts(hostVersion)
    return required.major === host.major && host.minor >= required.minor
  } catch {
    return false
  }
}

export function previewCapabilityUpdate(
  current: readonly ExtensionCapability[],
  next: readonly ExtensionCapability[],
) {
  const currentSet = new Set(current)
  const added = next.filter((capability) => !currentSet.has(capability)).sort()
  return { added, requiresApproval: added.length > 0, enabledAfterUpdate: added.length === 0 }
}

export class ImmutableExtensionStore {
  readonly packagesByIntegrity = new Map<string, ValidatedExtensionPackage>()
  readonly integrityByIdentity = new Map<string, string>()

  install(extensionPackage: ValidatedExtensionPackage) {
    const identity = `${extensionPackage.manifest.id}@${extensionPackage.manifest.version}`
    const existingIntegrity = this.integrityByIdentity.get(identity)
    if (existingIntegrity && existingIntegrity !== extensionPackage.integrity) {
      return { ok: false as const, code: "identity-integrity-conflict" as const }
    }
    this.integrityByIdentity.set(identity, extensionPackage.integrity)
    this.packagesByIntegrity.set(extensionPackage.integrity, extensionPackage)
    return { ok: true as const }
  }

  resolve(lockInput: unknown) {
    const lock = extensionLockSchema.safeParse(lockInput)
    if (!lock.success) return null
    const extensionPackage = this.packagesByIntegrity.get(lock.data.integrity)
    const matches = [
      extensionPackage?.manifest.id === lock.data.id,
      extensionPackage?.manifest.version === lock.data.version,
      extensionPackage?.manifest.apiVersion === lock.data.apiVersion,
    ].every(Boolean)
    return matches ? extensionPackage : null
  }
}

export function extensionLock(extensionPackage: ValidatedExtensionPackage): ExtensionLock {
  return extensionLockSchema.parse({
    id: extensionPackage.manifest.id,
    version: extensionPackage.manifest.version,
    apiVersion: extensionPackage.manifest.apiVersion,
    integrity: extensionPackage.integrity,
  })
}

export function resolveExtensionState(input: {
  installed: boolean
  enabled: boolean
  compatible: boolean
  runtimeFailure?: Exclude<
    ExtensionFailureState,
    "available" | "extension-missing" | "extension-disabled" | "extension-incompatible"
  >
}): ExtensionFailureState {
  if (!input.installed) return "extension-missing"
  if (!input.enabled) return "extension-disabled"
  if (!input.compatible) return "extension-incompatible"
  return input.runtimeFailure ?? "available"
}

export function preserveRestrictedFeaturePayload(payload: unknown) {
  try {
    return { ok: true as const, serialized: JSON.stringify(payload) }
  } catch (error) {
    return {
      ok: false as const,
      diagnostic: isError(error) ? "feature-payload-not-serializable" : "unknown-feature-payload",
    }
  }
}

export function compareUpdateInvariant(current: number, candidate: number) {
  return {
    matches: Object.is(current, candidate),
    current,
    candidate,
  }
}
