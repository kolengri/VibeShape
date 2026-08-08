import { z } from "zod"
import {
  applyDocumentCommand,
  type DocumentCommandOptions,
  type DocumentCommandResult,
  type DomainDiagnostic,
  parseDocumentCommand,
} from "./commands"
import type { DocumentSnapshot } from "./document"
import { featureTypeKey } from "./feature-type-contracts"
import type { FeatureTypeRegistry, FeatureValidationDiagnostic } from "./feature-type-registry"
import { technicalIdentifierSchema } from "./identifiers"
import {
  type CommandDescriptor,
  documentCoreModule,
  featureCoreModule,
  type ModuleRegistry,
} from "./modules"

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
  featureTypeKeys?: readonly string[]
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
  | "command-handler-feature-types-mismatch"

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
  moduleRegistry: ModuleRegistry,
  descriptor: CommandDescriptor,
  handler: TrustedCommandHandler,
): CommandDispatcherDiagnostic | null {
  if (handler.ownerModuleId !== descriptor.ownerModuleId) {
    return dispatcherDiagnostic(
      "command-handler-owner-mismatch",
      `Command handler ${handler.kind} does not belong to module ${descriptor.ownerModuleId}.`,
    )
  }

  if (handler.schemaVersion !== descriptor.schemaVersion) {
    return dispatcherDiagnostic(
      "command-handler-version-mismatch",
      `Command handler ${handler.kind} does not implement schema version ${descriptor.schemaVersion}.`,
    )
  }

  if (handler.featureTypeKeys) {
    const registered = moduleRegistry.featureTypes.map(({ type }) => featureTypeKey(type))
    if (
      handler.featureTypeKeys.length !== registered.length ||
      handler.featureTypeKeys.some((key, index) => key !== registered[index])
    ) {
      return dispatcherDiagnostic(
        "command-handler-feature-types-mismatch",
        `Command handler ${handler.kind} uses a different feature type composition.`,
      )
    }
  }

  return null
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

    const diagnostic = validateHandlerDescriptor(moduleRegistry, descriptor, handler)

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

function featureValidationResult(diagnostic: FeatureValidationDiagnostic): DocumentCommandResult {
  return {
    ok: false,
    diagnostic: {
      code: diagnostic.code === "invalid-feature" ? "invalid-command" : diagnostic.code,
      message: diagnostic.message,
      retryable: false,
      issues: diagnostic.issues.slice(0, 8),
    },
  }
}

function executeFeatureCommand(
  featureTypes: FeatureTypeRegistry,
  snapshot: DocumentSnapshot | null,
  input: unknown,
  options: DocumentCommandOptions,
): DocumentCommandResult {
  const parsed = parseDocumentCommand(input)

  if (!parsed.ok) return parsed
  if (
    parsed.command.kind === "org.vibeshape.document.create" ||
    parsed.command.kind === "org.vibeshape.document.rename"
  ) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid-command",
        message: "The feature handler received a document command.",
        retryable: false,
        issues: [],
      },
    }
  }
  if (parsed.command.kind === "org.vibeshape.feature.set-suppressed") {
    return applyDocumentCommand(snapshot, parsed.command, options)
  }

  const preflight = applyDocumentCommand(snapshot, parsed.command, options)
  if (!preflight.ok) return preflight

  const validated = featureTypes.validateFeature(parsed.command.payload.feature)
  if (!validated.ok) return featureValidationResult(validated.diagnostic)

  return applyDocumentCommand(
    snapshot,
    { ...parsed.command, payload: { feature: validated.feature } },
    options,
  )
}

export function createFeatureCoreCommandHandlers(
  featureTypes: FeatureTypeRegistry,
): readonly TrustedCommandHandler[] {
  const execute: TrustedCommandHandler["execute"] = (snapshot, input, options = {}) =>
    executeFeatureCommand(featureTypes, snapshot, input, options)
  const featureTypeKeys = featureTypes.descriptors.map(({ type }) => featureTypeKey(type))

  return [
    {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      ownerModuleId: featureCoreModule.id,
      featureTypeKeys,
      execute,
    },
    {
      kind: "org.vibeshape.feature.set-suppressed",
      schemaVersion: 1,
      ownerModuleId: featureCoreModule.id,
      featureTypeKeys,
      execute,
    },
    {
      kind: "org.vibeshape.feature.update",
      schemaVersion: 1,
      ownerModuleId: featureCoreModule.id,
      featureTypeKeys,
      execute,
    },
  ]
}

export function createCoreCommandHandlers(
  featureTypes: FeatureTypeRegistry,
): readonly TrustedCommandHandler[] {
  return [...documentCoreCommandHandlers, ...createFeatureCoreCommandHandlers(featureTypes)]
}
