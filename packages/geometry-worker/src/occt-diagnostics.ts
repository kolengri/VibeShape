import { isFunction } from "is-what"

type OpenCascadeDiagnosticModule = object & {
  VibeShapeOcctDiagnostics?: unknown
}

type OcctDiagnosticsBinding = {
  PurgeAllocator: () => unknown
  RunNativeBoxCycle: () => unknown
  RunNativeCylinderCycle: () => unknown
}

function isOcctDiagnosticsBinding(value: unknown): value is OcctDiagnosticsBinding {
  return (
    isFunction(value) &&
    isFunction(Reflect.get(value, "PurgeAllocator")) &&
    isFunction(Reflect.get(value, "RunNativeBoxCycle")) &&
    isFunction(Reflect.get(value, "RunNativeCylinderCycle"))
  )
}

function requireDiagnostics(opencascade: OpenCascadeDiagnosticModule) {
  const value: unknown = Reflect.get(opencascade, "VibeShapeOcctDiagnostics")

  if (!isOcctDiagnosticsBinding(value)) {
    throw new Error("Controlled OpenCascade lifecycle diagnostics are unavailable or malformed.")
  }

  return value
}

function requireNonNegativeInteger(name: string, value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`OpenCascade diagnostic ${name} returned an invalid value.`)
  }

  return Number(value)
}

export function purgeOcctAllocator(opencascade: OpenCascadeDiagnosticModule) {
  const diagnostics = requireDiagnostics(opencascade)

  return requireNonNegativeInteger(
    "PurgeAllocator",
    Reflect.apply(diagnostics.PurgeAllocator, diagnostics, []),
  )
}

export function runNativeOcctLifecycleCycle(
  opencascade: OpenCascadeDiagnosticModule,
  primitive: "box" | "cylinder",
) {
  const diagnostics = requireDiagnostics(opencascade)
  const method =
    primitive === "box" ? diagnostics.RunNativeBoxCycle : diagnostics.RunNativeCylinderCycle
  const result = requireNonNegativeInteger(
    primitive === "box" ? "RunNativeBoxCycle" : "RunNativeCylinderCycle",
    Reflect.apply(method, diagnostics, []),
  )

  if (result !== 1) {
    throw new Error(`Native OpenCascade ${primitive} lifecycle cycle produced a null solid.`)
  }
}
