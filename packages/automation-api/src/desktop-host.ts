import { z } from "zod"

export const DESKTOP_MCP_PATH = "/__vibeshape/native-mcp"
export const DESKTOP_MCP_SETUP_CHANNEL = "vibeshape:desktop:mcp-setup"
export const DESKTOP_MCP_DESCRIPTOR_NAME = "desktop-mcp.json"
export const DESKTOP_COMMAND_CHANNEL = "vibeshape:desktop:command"
export const DESKTOP_COMMAND_STATE_CHANNEL = "vibeshape:desktop:command-state"
export const DESKTOP_TEXT_EDIT_CHANNEL = "vibeshape:desktop:text-edit"

export const desktopEditorCommandSchema = z.enum([
  "undo",
  "redo",
  "createSketch",
  "createBox",
  "createCylinder",
  "createExtrusion",
  "createRevolve",
  "createFillet",
  "createChamfer",
  "measure",
])
export const desktopApplicationCommandSchema = z.enum([
  "projects",
  "export",
  "settings",
  "faq",
  "shortcuts",
])
export const desktopCommandSchema = z.union([
  desktopEditorCommandSchema,
  desktopApplicationCommandSchema,
])
export const desktopCommandEventSchema = z.strictObject({ id: desktopCommandSchema })
export const desktopCommandStateSchema = z.discriminatedUnion("scope", [
  z.strictObject({
    scope: z.literal("editor"),
    enabled: z.array(desktopEditorCommandSchema).max(10),
  }),
  z.strictObject({
    scope: z.literal("application"),
    enabled: z.array(desktopApplicationCommandSchema).max(5),
  }),
])
export const desktopTextEditSchema = z.enum(["undo", "redo"])

const localEndpoint = z
  .string()
  .max(256)
  .refine((value) => {
    const match = /^http:\/\/127\.0\.0\.1:(\d{4,5})(\/[^?#]*)$/.exec(value)
    if (!match) return false
    const port = Number(match[1])
    return (
      port >= 1024 && port <= 65535 && String(port) === match[1] && match[2] === DESKTOP_MCP_PATH
    )
  })
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.startsWith("/") && !value.includes("\0"))

export const desktopMcpDescriptorSchema = z.strictObject({
  protocolVersion: z.literal(1),
  endpoint: localEndpoint,
  token: z.string().regex(/^[a-f0-9]{64}$/),
  pid: z.number().int().positive(),
})

export const desktopMcpSetupSchema = z.strictObject({
  protocolVersion: z.literal(1),
  mcpServers: z.strictObject({
    vibeshape: z.strictObject({
      command: path,
      args: z.tuple([path, z.literal("--descriptor"), path]),
      env: z.strictObject({ ELECTRON_RUN_AS_NODE: z.literal("1") }),
    }),
  }),
})

export type DesktopMcpDescriptor = z.infer<typeof desktopMcpDescriptorSchema>
export type DesktopMcpSetup = z.infer<typeof desktopMcpSetupSchema>
export type DesktopCommand = z.infer<typeof desktopCommandSchema>
export type DesktopCommandState = z.infer<typeof desktopCommandStateSchema>
export type DesktopHostBridge = Readonly<{
  protocolVersion: 1
  platform: "darwin" | "other"
  windowChrome: "unified" | "standard"
  getMcpSetup(): Promise<DesktopMcpSetup>
  onCommand(callback: (command: DesktopCommand) => void): () => void
  updateCommandState(state: DesktopCommandState): Promise<void>
  editText(action: z.infer<typeof desktopTextEditSchema>): Promise<void>
}>
