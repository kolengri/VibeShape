import { z } from "zod"
import {
  applyDocumentCommand,
  type DocumentCommandOptions,
  type DocumentCommandResult,
  type DomainDiagnostic,
} from "./commands"
import type { DocumentSnapshot } from "./document"
import { technicalIdentifierSchema } from "./identifiers"
import { type CommandDescriptor, documentCoreModule, type ModuleRegistry } from "./modules"

const commandRouteSchema = z
  .object({
    kind: technicalIdentifierSchema,
    schemaVersion: z.number().int().positive().safe(),
  })
  .passthrough()

export type TrustedCommandHandler = Readonly<{
  kind: CommandDescriptor["kind"]
  schemaVersion: CommandDescriptor["schemaVersion"]
  ownerModuleId: CommandDescriptor["ownerModuleId"]
  execute: (
    snapshot: DocumentSnapshot | null,
    input: unknown,
    options?: DocumentCommandOptions,
  ) => DocumentCommandResult
}>

export type CommandDispatcherDiagnosticCode =
  | "invalid-command-route"
  | "unregistered-command"
  | "unsupported-command-version"
  | "duplicate-command-handler"
  | "missing-command-handler"
  | "orphan-command-handler"
  | "command-handler-owner-mismatch"
  | "command-handler-version-mismatch"

export type CommandDispatcherDiagnostic = Readonly<{
  code: CommandDispatcherDiagnosticCode
  message: string
  retryable: boolean
  issues: DomainDiagnostic["issues"]
}>

export type CommandDispatchResult =
  | DocumentCommandResult
  | { ok: false; diagnostic: CommandDispatcherDiagnostic }

export type CommandDispatcher = Readonly<{
  dispatch: (
    snapshot: DocumentSnapshot | null,
    input: unknown,
    options?: DocumentCommandOptions,
  ) => CommandDispatchResult
}>

export type CommandDispatcherResult =
  | { ok: true; dispatcher: CommandDispatcher }
  | { ok: false; diagnostic: CommandDispatcherDiagnostic }

function dispatcherDiagnostic(
  code: CommandDispatcherDiagnosticCode,
  message: string,
  issues: CommandDispatcherDiagnostic["issues"] = [],
): CommandDispatcherDiagnostic {
  return { code, message, retryable: false, issues }
}

function invalidRouteDiagnostic(error: z.ZodError): CommandDispatcherDiagnostic {
  return dispatcherDiagnostic(
    "invalid-command-route",
    "The command route is invalid.",
    error.issues.slice(0, 8).map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  )
}

function validateHandlerDescriptor(
  descriptor: CommandDescriptor,
  handler: TrustedCommandHandler,
): CommandDispatcherDiagnostic | null {
  if (handler.ownerModuleId !== descriptor.ownerModuleId) {
    return dispatcherDiagnostic(
      "command-handler-owner-mismatch",
      `Command handler ${handler.kind} does not belong to module ${descriptor.ownerModuleId}.`,
    )
  }

  return handler.schemaVersion === descriptor.schemaVersion
    ? null
    : dispatcherDiagnostic(
        "command-handler-version-mismatch",
        `Command handler ${handler.kind} does not implement schema version ${descriptor.schemaVersion}.`,
      )
}

function indexCommandHandlers(
  moduleRegistry: ModuleRegistry,
  handlers: readonly TrustedCommandHandler[],
) {
  const handlersByKind = new Map<string, TrustedCommandHandler>()

  for (const handler of handlers) {
    if (handlersByKind.has(handler.kind)) {
      return {
        ok: false,
        diagnostic: dispatcherDiagnostic(
          "duplicate-command-handler",
          `Command handler ${handler.kind} is registered twice.`,
        ),
      } as const
    }

    const descriptor = moduleRegistry.getCommand(handler.kind)

    if (!descriptor) {
      return {
        ok: false,
        diagnostic: dispatcherDiagnostic(
          "orphan-command-handler",
          `Command handler ${handler.kind} has no registered descriptor.`,
        ),
      } as const
    }

    const diagnostic = validateHandlerDescriptor(descriptor, handler)

    if (diagnostic) {
      return { ok: false, diagnostic } as const
    }

    handlersByKind.set(handler.kind, handler)
  }

  const missingDescriptor = moduleRegistry.commands.find(
    (descriptor) => !handlersByKind.has(descriptor.kind),
  )

  return missingDescriptor
    ? ({
        ok: false,
        diagnostic: dispatcherDiagnostic(
          "missing-command-handler",
          `Command ${missingDescriptor.kind} has no trusted handler.`,
        ),
      } as const)
    : ({ ok: true, handlersByKind } as const)
}

function dispatchCommand(
  moduleRegistry: ModuleRegistry,
  handlersByKind: ReadonlyMap<string, TrustedCommandHandler>,
  snapshot: DocumentSnapshot | null,
  input: unknown,
  options: DocumentCommandOptions,
): CommandDispatchResult {
  const route = commandRouteSchema.safeParse(input)

  if (!route.success) {
    return { ok: false, diagnostic: invalidRouteDiagnostic(route.error) }
  }

  const descriptor = moduleRegistry.getCommand(route.data.kind)
  const handler = handlersByKind.get(route.data.kind)

  if (!descriptor || !handler) {
    return {
      ok: false,
      diagnostic: dispatcherDiagnostic(
        "unregistered-command",
        `Command ${route.data.kind} is not registered.`,
      ),
    }
  }

  if (route.data.schemaVersion !== descriptor.schemaVersion) {
    return {
      ok: false,
      diagnostic: dispatcherDiagnostic(
        "unsupported-command-version",
        `Command ${route.data.kind} schema version ${route.data.schemaVersion} is not supported.`,
      ),
    }
  }

  return handler.execute(snapshot, input, options)
}

export function createCommandDispatcher(
  moduleRegistry: ModuleRegistry,
  handlers: readonly TrustedCommandHandler[],
): CommandDispatcherResult {
  const indexed = indexCommandHandlers(moduleRegistry, handlers)

  return indexed.ok
    ? {
        ok: true,
        dispatcher: {
          dispatch: (snapshot, input, options = {}) =>
            dispatchCommand(moduleRegistry, indexed.handlersByKind, snapshot, input, options),
        },
      }
    : indexed
}

export const documentCoreCommandHandlers: readonly TrustedCommandHandler[] = [
  {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: applyDocumentCommand,
  },
  {
    kind: "org.vibeshape.document.rename",
    schemaVersion: 1,
    ownerModuleId: documentCoreModule.id,
    execute: applyDocumentCommand,
  },
]
