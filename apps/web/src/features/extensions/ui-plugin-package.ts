import { z } from "zod"
import { parseUiPluginJson } from "./ui-plugin-json"

export const UI_PLUGIN_FILE_BYTES = 64 * 1024
export const uiPluginCapabilitySchema = z.enum(["ui.command", "ui.panel"])
const localId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)
const boundedNumber = z.number().finite().min(-1e9).max(1e9)
const label = z.string().trim().min(1).max(120)

const inputSchema = z
  .strictObject({
    id: localId,
    label,
    unit: z.string().max(24),
    min: boundedNumber,
    max: boundedNumber,
    default: boundedNumber,
    step: z.number().finite().positive().max(1e9),
  })
  .refine(
    (input) => input.min < input.max && input.default >= input.min && input.default <= input.max,
  )

const outputSchema = z.strictObject({
  id: localId,
  label,
  unit: z.string().max(24),
  constant: boundedNumber,
  terms: z
    .array(z.strictObject({ inputId: localId, coefficient: boundedNumber }))
    .min(1)
    .max(8),
})

export const uiPluginPanelSchema = z
  .strictObject({
    id: localId,
    title: label,
    description: z.string().max(600),
    inputs: z.array(inputSchema).min(1).max(8),
    outputs: z.array(outputSchema).min(1).max(8),
  })
  .refine((panel) => {
    const inputs = new Set(panel.inputs.map(({ id }) => id))
    return (
      inputs.size === panel.inputs.length &&
      new Set(panel.outputs.map(({ id }) => id)).size === panel.outputs.length &&
      panel.outputs.every((output) => output.terms.every(({ inputId }) => inputs.has(inputId)))
    )
  })

const uiPluginPackageSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    profile: z.literal("declarative-ui"),
    id: z
      .string()
      .max(160)
      .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
    version: z
      .string()
      .max(32)
      .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
    name: label,
    description: z.string().max(600),
    license: z.string().trim().min(1).max(80),
    capabilities: z
      .array(uiPluginCapabilitySchema)
      .length(2)
      .refine((capabilities) => new Set(capabilities).size === 2),
    commands: z
      .array(z.strictObject({ id: localId, label, panelId: localId }))
      .min(1)
      .max(4),
    panels: z.array(uiPluginPanelSchema).min(1).max(4),
  })
  .refine((plugin) => {
    const panels = new Set(plugin.panels.map(({ id }) => id))
    return (
      panels.size === plugin.panels.length &&
      new Set(plugin.commands.map(({ id }) => id)).size === plugin.commands.length &&
      plugin.commands.every(({ panelId }) => panels.has(panelId))
    )
  })

export type UiPluginManifest = z.infer<typeof uiPluginPackageSchema>
export type UiPluginCapability = z.infer<typeof uiPluginCapabilitySchema>
export type UiPluginPackage = Readonly<{
  manifest: UiPluginManifest
  source: string
  integrity: string
}>
export type UiPluginError =
  | "invalid-package"
  | "package-too-large"
  | "invalid-utf8"
  | "integrity-mismatch"
  | "invalid-store"
  | "storage-unavailable"
  | "store-full"
  | "identity-conflict"
  | "not-installed"
  | "permission-denied"
  | "stale-store"
export type UiPluginResult<T> = { ok: true; value: T } | { ok: false; error: UiPluginError }

export async function readUiPluginPackage(
  bytes: Uint8Array,
): Promise<UiPluginResult<UiPluginPackage>> {
  if (bytes.byteLength > UI_PLUGIN_FILE_BYTES) return { ok: false, error: "package-too-large" }
  let source: string
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return { ok: false, error: "invalid-utf8" }
  }
  let value: unknown
  try {
    value = parseUiPluginJson(source)
  } catch {
    return { ok: false, error: "invalid-package" }
  }
  const parsed = uiPluginPackageSchema.safeParse(value)
  if (!parsed.success) return { ok: false, error: "invalid-package" }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))
  const integrity = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return { ok: true, value: { source, manifest: parsed.data, integrity } }
}
