import { z } from "zod"
import {
  type FeatureTypeDescriptor,
  type FeatureTypeIdentity,
  featureTypeDescriptorSchema,
  featureTypeKey,
} from "./feature-type-contracts"
import { moduleIdSchema, moduleVersionSchema, technicalIdentifierSchema } from "./identifiers"
import { booleanFeatureType, boxFeatureType, cylinderFeatureType } from "./part-design"

export const commandDescriptorSchema = z
  .object({
    kind: technicalIdentifierSchema,
    schemaVersion: z.number().int().positive().safe(),
    ownerModuleId: moduleIdSchema,
    confirmation: z.enum(["none", "review", "destructive"]),
    automation: z
      .object({
        exposure: z.enum(["none", "draft"]),
        readOnly: z.boolean(),
        destructive: z.boolean(),
        idempotent: z.boolean(),
        openWorld: z.boolean(),
      })
      .strict(),
  })
  .strict()

export const queryDescriptorSchema = z
  .object({
    kind: technicalIdentifierSchema,
    schemaVersion: z.number().int().positive().safe(),
    ownerModuleId: moduleIdSchema,
    classification: z.enum(["semantic", "derived"]),
    automation: z
      .object({
        exposure: z.enum(["none", "resource"]),
        pagination: z.enum(["none", "cursor"]),
      })
      .strict(),
  })
  .strict()

export const moduleDescriptorSchema = z
  .object({
    id: moduleIdSchema,
    version: moduleVersionSchema,
    dependencies: z.array(moduleIdSchema),
    commands: z.array(commandDescriptorSchema),
    queries: z.array(queryDescriptorSchema),
    featureTypes: z.array(featureTypeDescriptorSchema).default([]),
  })
  .strict()

export type CommandDescriptor = Readonly<z.infer<typeof commandDescriptorSchema>>
export type QueryDescriptor = Readonly<z.infer<typeof queryDescriptorSchema>>
export type ModuleDescriptor = Readonly<z.infer<typeof moduleDescriptorSchema>>

export type ModuleRegistryDiagnostic = Readonly<{
  code:
    | "invalid-module"
    | "duplicate-module"
    | "duplicate-command"
    | "duplicate-query"
    | "duplicate-feature-type"
    | "command-owner-mismatch"
    | "query-owner-mismatch"
    | "feature-type-owner-mismatch"
    | "feature-type-version-mismatch"
    | "missing-module-dependency"
    | "module-dependency-cycle"
  message: string
}>

export type ModuleRegistry = Readonly<{
  modules: readonly ModuleDescriptor[]
  commands: readonly CommandDescriptor[]
  queries: readonly QueryDescriptor[]
  featureTypes: readonly FeatureTypeDescriptor[]
  getModule: (id: string) => ModuleDescriptor | undefined
  getCommand: (kind: string) => CommandDescriptor | undefined
  getQuery: (kind: string) => QueryDescriptor | undefined
  getFeatureType: (type: FeatureTypeIdentity) => FeatureTypeDescriptor | undefined
}>

export type ModuleRegistryResult =
  | { ok: true; registry: ModuleRegistry }
  | { ok: false; diagnostic: ModuleRegistryDiagnostic }

type RegistryStepResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; diagnostic: ModuleRegistryDiagnostic }

type IndexedModules = Readonly<{
  modulesById: Map<string, ModuleDescriptor>
  commandsByKind: Map<string, CommandDescriptor>
  queriesByKind: Map<string, QueryDescriptor>
  featureTypesByKey: Map<string, FeatureTypeDescriptor>
}>

export const documentCoreModule: ModuleDescriptor = moduleDescriptorSchema.parse({
  id: "org.vibeshape.core.document",
  version: "0.1.0",
  dependencies: [],
  commands: [
    {
      kind: "org.vibeshape.document.create",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.document.rename",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.variable.add",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.variable.set-expression",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.variable.rename",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: true,
      },
    },
    {
      kind: "org.vibeshape.variable.remove",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "destructive",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: true,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.variable.replace-table",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "destructive",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: true,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.sketch.update",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.sketch.remove",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      confirmation: "destructive",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: true,
        idempotent: false,
        openWorld: false,
      },
    },
  ],
  queries: [
    {
      kind: "org.vibeshape.document.summary",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      classification: "semantic",
      automation: {
        exposure: "resource",
        pagination: "none",
      },
    },
    {
      kind: "org.vibeshape.variable.list",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.document",
      classification: "semantic",
      automation: {
        exposure: "resource",
        pagination: "cursor",
      },
    },
  ],
})

export const featureCoreModule: ModuleDescriptor = moduleDescriptorSchema.parse({
  id: "org.vibeshape.core.features",
  version: "0.1.0",
  dependencies: [documentCoreModule.id],
  commands: [
    {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.features",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: true,
      },
    },
    {
      kind: "org.vibeshape.feature.remove",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.features",
      confirmation: "destructive",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: true,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.feature.set-suppressed",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.features",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: false,
      },
    },
    {
      kind: "org.vibeshape.feature.update",
      schemaVersion: 1,
      ownerModuleId: "org.vibeshape.core.features",
      confirmation: "review",
      automation: {
        exposure: "draft",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: true,
      },
    },
  ],
  queries: [],
})

export const partDesignModule: ModuleDescriptor = moduleDescriptorSchema.parse({
  id: "org.vibeshape.core.part-design",
  version: "0.1.0",
  dependencies: [featureCoreModule.id],
  commands: [],
  queries: [],
  featureTypes: [booleanFeatureType, boxFeatureType, cylinderFeatureType],
})

function registryFailure(
  code: ModuleRegistryDiagnostic["code"],
  message: string,
): ModuleRegistryResult {
  return { ok: false, diagnostic: { code, message } }
}

function stepFailure(
  code: ModuleRegistryDiagnostic["code"],
  message: string,
): { ok: false; diagnostic: ModuleRegistryDiagnostic } {
  return { ok: false, diagnostic: { code, message } }
}

function hasDependencyCycle(modules: readonly ModuleDescriptor[]) {
  const remainingDependencies = new Map(
    modules.map((module) => [module.id, new Set(module.dependencies)]),
  )
  const resolved = new Set<string>()

  while (resolved.size < modules.length) {
    const ready = modules
      .filter(
        (module) =>
          !resolved.has(module.id) &&
          [...(remainingDependencies.get(module.id) ?? [])].every((dependency) =>
            resolved.has(dependency),
          ),
      )
      .map((module) => module.id)

    if (ready.length === 0) {
      return true
    }

    for (const moduleId of ready) {
      resolved.add(moduleId)
    }
  }

  return false
}

function parseModuleDescriptors(
  inputs: readonly unknown[],
): RegistryStepResult<ModuleDescriptor[]> {
  const parsedModules: ModuleDescriptor[] = []

  for (const input of inputs) {
    const parsed = moduleDescriptorSchema.safeParse(input)

    if (!parsed.success) {
      return stepFailure("invalid-module", "A module descriptor is invalid.")
    }

    parsedModules.push(parsed.data)
  }

  return { ok: true, value: parsedModules }
}

function indexModuleCommands(
  module: ModuleDescriptor,
  commandsByKind: Map<string, CommandDescriptor>,
): ModuleRegistryDiagnostic | null {
  for (const command of module.commands) {
    if (command.ownerModuleId !== module.id) {
      return {
        code: "command-owner-mismatch",
        message: `Command ${command.kind} does not belong to module ${module.id}.`,
      }
    }

    if (commandsByKind.has(command.kind)) {
      return {
        code: "duplicate-command",
        message: `Command ${command.kind} is registered twice.`,
      }
    }

    commandsByKind.set(command.kind, command)
  }

  return null
}

function indexModuleQueries(
  module: ModuleDescriptor,
  queriesByKind: Map<string, QueryDescriptor>,
): ModuleRegistryDiagnostic | null {
  for (const query of module.queries) {
    if (query.ownerModuleId !== module.id) {
      return {
        code: "query-owner-mismatch",
        message: `Query ${query.kind} does not belong to module ${module.id}.`,
      }
    }

    if (queriesByKind.has(query.kind)) {
      return {
        code: "duplicate-query",
        message: `Query ${query.kind} is registered twice.`,
      }
    }

    queriesByKind.set(query.kind, query)
  }

  return null
}

function indexModuleFeatureTypes(
  module: ModuleDescriptor,
  featureTypesByKey: Map<string, FeatureTypeDescriptor>,
): ModuleRegistryDiagnostic | null {
  for (const featureType of module.featureTypes) {
    if (featureType.type.moduleId !== module.id) {
      return {
        code: "feature-type-owner-mismatch",
        message: `Feature type ${featureType.type.typeId} does not belong to module ${module.id}.`,
      }
    }

    if (featureType.type.moduleVersion !== module.version) {
      return {
        code: "feature-type-version-mismatch",
        message: `Feature type ${featureType.type.typeId} does not use module version ${module.version}.`,
      }
    }

    const key = featureTypeKey(featureType.type)
    if (featureTypesByKey.has(key)) {
      return {
        code: "duplicate-feature-type",
        message: `Feature type ${key} is registered twice.`,
      }
    }

    featureTypesByKey.set(key, featureType)
  }

  return null
}

function indexModuleDescriptors(
  modules: readonly ModuleDescriptor[],
): RegistryStepResult<IndexedModules> {
  const modulesById = new Map<string, ModuleDescriptor>()
  const commandsByKind = new Map<string, CommandDescriptor>()
  const queriesByKind = new Map<string, QueryDescriptor>()
  const featureTypesByKey = new Map<string, FeatureTypeDescriptor>()

  for (const module of modules) {
    if (modulesById.has(module.id)) {
      return stepFailure("duplicate-module", `Module ${module.id} is registered twice.`)
    }

    modulesById.set(module.id, module)

    const contributionDiagnostic =
      indexModuleCommands(module, commandsByKind) ??
      indexModuleQueries(module, queriesByKind) ??
      indexModuleFeatureTypes(module, featureTypesByKey)

    if (contributionDiagnostic) {
      return { ok: false, diagnostic: contributionDiagnostic }
    }
  }

  return {
    ok: true,
    value: { modulesById, commandsByKind, queriesByKind, featureTypesByKey },
  }
}

function validateModuleDependencies(
  modules: readonly ModuleDescriptor[],
  modulesById: ReadonlyMap<string, ModuleDescriptor>,
): ModuleRegistryDiagnostic | null {
  for (const module of modules) {
    for (const dependency of module.dependencies) {
      if (!modulesById.has(dependency)) {
        return {
          code: "missing-module-dependency",
          message: `Module ${module.id} requires missing module ${dependency}.`,
        }
      }
    }
  }

  return hasDependencyCycle(modules)
    ? {
        code: "module-dependency-cycle",
        message: "The module dependency graph contains a cycle.",
      }
    : null
}

export function createModuleRegistry(inputs: readonly unknown[]): ModuleRegistryResult {
  const parsed = parseModuleDescriptors(inputs)

  if (!parsed.ok) {
    return parsed
  }

  const indexed = indexModuleDescriptors(parsed.value)

  if (!indexed.ok) {
    return indexed
  }

  const dependencyDiagnostic = validateModuleDependencies(parsed.value, indexed.value.modulesById)

  if (dependencyDiagnostic) {
    return registryFailure(dependencyDiagnostic.code, dependencyDiagnostic.message)
  }

  const modules = [...parsed.value].sort((left, right) => left.id.localeCompare(right.id))
  const commands = [...indexed.value.commandsByKind.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind),
  )
  const queries = [...indexed.value.queriesByKind.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind),
  )
  const featureTypes = [...indexed.value.featureTypesByKey.values()].sort((left, right) =>
    featureTypeKey(left.type).localeCompare(featureTypeKey(right.type)),
  )

  return {
    ok: true,
    registry: {
      modules,
      commands,
      queries,
      featureTypes,
      getModule: (id) => indexed.value.modulesById.get(id),
      getCommand: (kind) => indexed.value.commandsByKind.get(kind),
      getQuery: (kind) => indexed.value.queriesByKind.get(kind),
      getFeatureType: (type) => indexed.value.featureTypesByKey.get(featureTypeKey(type)),
    },
  }
}
