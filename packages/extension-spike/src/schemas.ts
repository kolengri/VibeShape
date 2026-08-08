import { moduleVersionSchema, sessionIdSchema, technicalIdentifierSchema } from "@vibeshape/domain"
import { z } from "zod"

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 digest.")
export const extensionApiVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Expected a major.minor API version.")

export const extensionCapabilitySchema = z.enum([
  "model.read",
  "model.command",
  "selection.read",
  "geometry.query",
  "ui.command",
  "ui.panel",
  "file.open",
  "file.save",
  "clipboard.write",
  "network.connect",
])

export const extensionEntrypointsSchema = z
  .object({
    feature: z.string().min(1).max(160).optional(),
    workspace: z.string().min(1).max(160).optional(),
    ui: z.string().min(1).max(160).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).length > 0, "At least one entry point is required.")

export const extensionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: technicalIdentifierSchema,
    name: z.string().trim().min(1).max(80),
    version: moduleVersionSchema,
    apiVersion: extensionApiVersionSchema,
    license: z.string().trim().min(1).max(80),
    entrypoints: extensionEntrypointsSchema,
    capabilities: z
      .array(extensionCapabilitySchema)
      .max(16)
      .refine((values) => new Set(values).size === values.length, "Capabilities must be unique."),
    files: z.record(z.string().min(1).max(160), sha256Schema),
  })
  .strict()

export const extensionSignatureSchema = z
  .object({
    schemaVersion: z.literal(0),
    algorithm: z.literal("ECDSA-P256-SHA256"),
    keyId: sha256Schema,
    signature: z.string().min(1).max(256),
  })
  .strict()

export const extensionLockSchema = z
  .object({
    id: technicalIdentifierSchema,
    version: moduleVersionSchema,
    apiVersion: extensionApiVersionSchema,
    integrity: sha256Schema,
  })
  .strict()

export const panelHostMessageSchema = z
  .object({
    type: z.literal("vibeshape.extension.initialize"),
    schemaVersion: z.literal(0),
    extensionId: technicalIdentifierSchema,
    sessionNonce: sessionIdSchema,
  })
  .strict()

export const panelExtensionMessageSchema = z
  .object({
    schemaVersion: z.literal(0),
    extensionId: technicalIdentifierSchema,
    sessionNonce: sessionIdSchema,
    sequence: z.number().int().nonnegative().max(1_000),
    type: z.enum(["ready", "command"]),
    capability: z.literal("ui.command"),
    commandId: technicalIdentifierSchema.nullable(),
    opaqueOrigin: z.boolean(),
  })
  .strict()

export const extensionFailureStateSchema = z.enum([
  "available",
  "extension-missing",
  "extension-disabled",
  "extension-incompatible",
  "extension-timeout",
  "extension-resource-limit",
  "extension-failed",
])

export type ExtensionCapability = z.infer<typeof extensionCapabilitySchema>
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>
export type ExtensionSignature = z.infer<typeof extensionSignatureSchema>
export type ExtensionLock = z.infer<typeof extensionLockSchema>
export type PanelExtensionMessage = z.infer<typeof panelExtensionMessageSchema>
export type ExtensionFailureState = z.infer<typeof extensionFailureStateSchema>
