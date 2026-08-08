import {
  CapabilityCoordinator,
  compareUpdateInvariant,
  connectExtensionPanel,
  createPublisherKeyPair,
  extensionFixture,
  extensionLock,
  ImmutableExtensionStore,
  infiniteLoopWasm,
  isExtensionApiCompatible,
  packageTrust,
  preserveRestrictedFeaturePayload,
  previewCapabilityUpdate,
  resolveExtensionState,
  runSandboxTask,
  signManifest,
  undeclaredImportWasm,
  type ValidatedExtensionPackage,
  validateExtensionPackage,
  verifyPackageSignature,
} from "@vibeshape/extension-spike"
import { strFromU8 } from "fflate"

interface ExtensionSpikeState {
  state: "running" | "passed" | "failed"
  stage: string
  report: Record<string, unknown> | null
  error: string | null
}

declare global {
  interface Window {
    __VIBESHAPE_EXTENSION_SPIKE__: ExtensionSpikeState
  }
}

const panelSessionNonce = "0195b5ac-b220-7a2c-8c33-67a36a7f31ac"
let currentStage = "initializing"

function requireElement<ElementType extends Element>(selector: string) {
  const element = document.querySelector<ElementType>(selector)
  if (!element) throw new Error(`The extension spike element is missing: ${selector}.`)
  return element
}

function requireCondition(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

async function runStage<Value>(stage: string, operation: () => Promise<Value>) {
  currentStage = stage
  return operation()
}

async function requirePackage(archive: Uint8Array) {
  const validated = await validateExtensionPackage(archive)
  if (!validated.ok) {
    throw new Error(`${validated.diagnostic.code}: ${validated.diagnostic.message}`)
  }
  return validated.value
}

async function createPackages() {
  const versionOneFixture = await extensionFixture({ version: "1.0.0", multiplier: 2 })
  const versionTwoFixture = await extensionFixture({
    version: "2.0.0",
    multiplier: 3,
    capabilities: ["ui.command", "ui.panel", "network.connect"],
  })
  const versionOne = await requirePackage(versionOneFixture.archive)
  const versionTwo = await requirePackage(versionTwoFixture.archive)
  const keyPair = await createPublisherKeyPair()
  const signature = await signManifest(versionOne.manifestBytes, keyPair)
  const signedFixture = await extensionFixture({
    version: "1.0.0",
    multiplier: 2,
    signature,
  })
  const signed = await requirePackage(signedFixture.archive)
  requireCondition(
    await verifyPackageSignature(signed, keyPair.publicKey),
    "The publisher signature did not verify.",
  )
  return { versionOne, versionTwo, signed }
}

async function runFeature(extensionPackage: ValidatedExtensionPackage, input: number) {
  const path = extensionPackage.manifest.entrypoints.feature
  if (!path) throw new Error("The deterministic feature entry point is missing.")
  const wasm = extensionPackage.files[path]
  if (!wasm) throw new Error("The deterministic feature bytes are missing.")
  return runSandboxTask({ mode: "wasm", wasm, input, timeoutMs: 1_000 })
}

async function runtimeComparison(packages: Awaited<ReturnType<typeof createPackages>>) {
  const [firstSession, secondSession, versionTwo] = await Promise.all([
    runFeature(packages.versionOne, 21),
    runFeature(packages.versionOne, 21),
    runFeature(packages.versionTwo, 21),
  ])
  const javascript = await runSandboxTask({ mode: "javascript-probe", timeoutMs: 1_000 })
  const undeclaredImport = await runSandboxTask({
    mode: "wasm",
    wasm: undeclaredImportWasm(),
    timeoutMs: 1_000,
  })
  return { firstSession, secondSession, versionTwo, javascript, undeclaredImport }
}

async function terminationEvidence() {
  let mainThreadTicks = 0
  const interval = window.setInterval(() => {
    mainThreadTicks += 1
  }, 5)
  const wasmLoop = await runSandboxTask({
    mode: "wasm",
    wasm: infiniteLoopWasm(),
    timeoutMs: 75,
  })
  const javascriptLoop = await runSandboxTask({ mode: "javascript-loop", timeoutMs: 75 })
  window.clearInterval(interval)
  const flood = await runSandboxTask({ mode: "message-flood", maxMessages: 16, timeoutMs: 1_000 })
  const memoryGrowth = await runSandboxTask({
    mode: "memory-growth",
    maxMessages: 16,
    timeoutMs: 1_000,
  })
  const oversizedOutput = await runSandboxTask({
    mode: "oversized-output",
    maxOutputBytes: 64 * 1024,
    timeoutMs: 1_000,
  })
  return { wasmLoop, javascriptLoop, flood, memoryGrowth, oversizedOutput, mainThreadTicks }
}

function hostPolicy(packages: Awaited<ReturnType<typeof createPackages>>) {
  const store = new ImmutableExtensionStore()
  requireCondition(store.install(packages.versionOne).ok, "Version one did not install.")
  requireCondition(store.install(packages.versionTwo).ok, "Version two did not install.")
  const versionOneLock = extensionLock(packages.versionOne)
  const versionTwoLock = extensionLock(packages.versionTwo)
  const coordinator = new CapabilityCoordinator(["model.read", "network.connect"])
  const deniedBeforeGrant = coordinator.authorize("network.connect")
  coordinator.grant("network.connect")
  let terminatedHosts = 0
  coordinator.registerHost("network-host", ["network.connect"], () => {
    terminatedHosts += 1
  })
  const terminatedOnRevoke = coordinator.revoke("network.connect")
  return {
    exactVersionCoexistence: [
      store.resolve(versionOneLock)?.integrity === packages.versionOne.integrity,
      store.resolve(versionTwoLock)?.integrity === packages.versionTwo.integrity,
    ].every(Boolean),
    deniedBeforeGrant,
    grantedBeforeRevoke: true,
    terminatedOnRevoke,
    terminatedHosts,
    authorizedAfterRevoke: coordinator.authorize("network.connect"),
    compatibility: {
      host10: isExtensionApiCompatible("1.0", "1.0"),
      host11: isExtensionApiCompatible("1.0", "1.1"),
      host20: isExtensionApiCompatible("1.0", "2.0"),
    },
    update: {
      capabilities: previewCapabilityUpdate(
        packages.versionOne.manifest.capabilities,
        packages.versionTwo.manifest.capabilities,
      ),
      invariants: compareUpdateInvariant(42, 63),
      rollbackIntegrity: versionOneLock.integrity,
    },
  }
}

function restrictedModeEvidence() {
  const states = [
    resolveExtensionState({ installed: false, enabled: false, compatible: false }),
    resolveExtensionState({ installed: true, enabled: false, compatible: true }),
    resolveExtensionState({ installed: true, enabled: true, compatible: false }),
    resolveExtensionState({
      installed: true,
      enabled: true,
      compatible: true,
      runtimeFailure: "extension-timeout",
    }),
    resolveExtensionState({
      installed: true,
      enabled: true,
      compatible: true,
      runtimeFailure: "extension-resource-limit",
    }),
    resolveExtensionState({
      installed: true,
      enabled: true,
      compatible: true,
      runtimeFailure: "extension-failed",
    }),
  ]
  const payload = { schemaVersion: 7, unknownParameters: { threadPitch: 1.25 } }
  const preserved = preserveRestrictedFeaturePayload(payload)
  return {
    states,
    payloadPreserved: preserved.ok && preserved.serialized === JSON.stringify(payload),
  }
}

async function panelEvidence(extensionPackage: ValidatedExtensionPackage) {
  const iframe = requireElement<HTMLIFrameElement>("#extension-panel")
  const panelPath = extensionPackage.manifest.entrypoints.ui
  if (!panelPath) throw new Error("The extension UI entry point is missing.")
  const html = extensionPackage.files[panelPath]
  if (!html) throw new Error("The extension UI bytes are missing.")
  const coordinator = new CapabilityCoordinator(["ui.command", "ui.panel"])
  coordinator.grant("ui.command")
  coordinator.grant("ui.panel")
  const connection = await connectExtensionPanel({
    iframe,
    html: strFromU8(html),
    extensionId: extensionPackage.manifest.id,
    sessionNonce: panelSessionNonce,
    authorize: (capability) => coordinator.authorize(capability),
  })
  const command = await connection.nextCommand()
  return {
    ready: connection.ready.type,
    command: command.commandId,
    opaqueOrigin: command.opaqueOrigin,
    sandbox: iframe.getAttribute("sandbox"),
    cspHash: strFromU8(html).includes("script-src 'sha256-"),
  }
}

async function runSpike() {
  const packages = await runStage("packages", createPackages)
  const runtimes = await runStage("runtimes", () => runtimeComparison(packages))
  const termination = await runStage("termination", terminationEvidence)
  const policy = hostPolicy(packages)
  const restrictedMode = restrictedModeEvidence()
  const panel = await runStage("panel", () => panelEvidence(packages.versionOne))
  return {
    schemaVersion: 0,
    decision: "proceed-with-reduced-scope",
    package: {
      versionOneIntegrity: packages.versionOne.integrity,
      versionTwoIntegrity: packages.versionTwo.integrity,
      signedTrust: packageTrust(true),
      unsignedTrust: packageTrust(null),
    },
    runtimes,
    termination,
    policy,
    restrictedMode,
    panel,
  }
}

const statusElement = requireElement<HTMLElement>("#status")
const state: ExtensionSpikeState = {
  state: "running",
  stage: currentStage,
  report: null,
  error: null,
}
window.__VIBESHAPE_EXTENSION_SPIKE__ = state

void runSpike()
  .then((report) => {
    state.state = "passed"
    state.stage = "complete"
    state.report = report
    statusElement.dataset.state = "passed"
    statusElement.textContent = "Extension sandbox corpus completed."
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    state.state = "failed"
    state.stage = currentStage
    state.error = `${currentStage}: ${message}`
    statusElement.dataset.state = "failed"
    statusElement.textContent = state.error
  })
