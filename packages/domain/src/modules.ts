import { z } from "zod"
import { moduleIdSchema, moduleVersionSchema, technicalIdentifierSchema } from "./identifiers"

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

export const moduleDescriptorSchema = z
  .object({
    id: moduleIdSchema,
    version: moduleVersionSchema,
    dependencies: z.array(moduleIdSchema),
    commands: z.array(commandDescriptorSchema),
  })
  .strict()

export type CommandDescriptor = Readonly<z.infer<typeof commandDescriptorSchema>>
export type ModuleDescriptor = Readonly<z.infer<typeof moduleDescriptorSchema>>

export type ModuleRegistryDiagnostic = Readonly<{
  code:
    | "invalid-module"
    | "duplicate-module"
    | "duplicate-command"
    | "command-owner-mismatch"
    | "missing-module-dependency"
    | "module-dependency-cycle"
  message: string
}>

export type ModuleRegistry = Readonly<{
  modules: readonly ModuleDescriptor[]
  commands: readonly CommandDescriptor[]
  getModule: (id: string) => ModuleDescriptor | undefined
  getCommand: (kind: string) => CommandDescriptor | undefined
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
  ],
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

function indexModuleDescriptors(
  modules: readonly ModuleDescriptor[],
): RegistryStepResult<IndexedModules> {
  const modulesById = new Map<string, ModuleDescriptor>()
  const commandsByKind = new Map<string, CommandDescriptor>()

  for (const module of modules) {
    if (modulesById.has(module.id)) {
      return stepFailure("duplicate-module", `Module ${module.id} is registered twice.`)
    }

    modulesById.set(module.id, module)

    for (const command of module.commands) {
      if (command.ownerModuleId !== module.id) {
        return stepFailure(
          "command-owner-mismatch",
          `Command ${command.kind} does not belong to module ${module.id}.`,
        )
      }

      if (commandsByKind.has(command.kind)) {
        return stepFailure("duplicate-command", `Command ${command.kind} is registered twice.`)
      }

      commandsByKind.set(command.kind, command)
    }
  }

  return { ok: true, value: { modulesById, commandsByKind } }
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

  return {
    ok: true,
    registry: {
      modules,
      commands,
      getModule: (id) => indexed.value.modulesById.get(id),
      getCommand: (kind) => indexed.value.commandsByKind.get(kind),
    },
  }
}
