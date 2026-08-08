import { describe, expect, it } from "vitest"
import { createModuleRegistry, documentCoreModule } from "./modules"

function moduleDescriptor(
  id: string,
  dependencies: string[] = [],
  commandKind = `${id}.command.run`,
) {
  return {
    id,
    version: "1.0.0",
    dependencies,
    commands: [
      {
        kind: commandKind,
        schemaVersion: 1,
        ownerModuleId: id,
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
    queries: [
      {
        kind: `${id}.query.summary`,
        schemaVersion: 1,
        ownerModuleId: id,
        classification: "semantic",
        automation: {
          exposure: "resource",
          pagination: "none",
        },
      },
    ],
  }
}

describe("module registry", () => {
  it("registers the first-party document module and exposes contribution metadata", () => {
    const result = createModuleRegistry([documentCoreModule])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.registry.getModule("org.vibeshape.core.document")).toEqual(documentCoreModule)
      expect(result.registry.getCommand("org.vibeshape.document.rename")).toMatchObject({
        ownerModuleId: "org.vibeshape.core.document",
        automation: { exposure: "draft", idempotent: false },
      })
      expect(result.registry.getCommand("org.vibeshape.unknown")).toBeUndefined()
      expect(result.registry.getQuery("org.vibeshape.document.summary")).toMatchObject({
        ownerModuleId: "org.vibeshape.core.document",
        classification: "semantic",
        automation: { exposure: "resource", pagination: "none" },
      })
      expect(result.registry.getQuery("org.vibeshape.unknown")).toBeUndefined()
    }
  })

  it("returns contributions in deterministic identifier order", () => {
    const beta = moduleDescriptor("org.example.beta")
    const alpha = moduleDescriptor("org.example.alpha")
    const result = createModuleRegistry([beta, alpha])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.registry.modules.map((module) => module.id)).toEqual([
        "org.example.alpha",
        "org.example.beta",
      ])
      expect(result.registry.commands.map((command) => command.kind)).toEqual([
        "org.example.alpha.command.run",
        "org.example.beta.command.run",
      ])
      expect(result.registry.queries.map((query) => query.kind)).toEqual([
        "org.example.alpha.query.summary",
        "org.example.beta.query.summary",
      ])
    }
  })

  it("rejects invalid and duplicate modules", () => {
    expect(createModuleRegistry([{ id: "invalid" }])).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-module" },
    })
    expect(createModuleRegistry([documentCoreModule, documentCoreModule])).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-module" },
    })
  })

  it("rejects duplicate commands and owner mismatches", () => {
    const alpha = moduleDescriptor("org.example.alpha", [], "org.example.shared.run")
    const beta = moduleDescriptor("org.example.beta", [], "org.example.shared.run")
    const wrongOwner = {
      ...alpha,
      commands: [{ ...alpha.commands[0], ownerModuleId: "org.example.beta" }],
    }

    expect(createModuleRegistry([alpha, beta])).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-command" },
    })
    expect(createModuleRegistry([wrongOwner])).toMatchObject({
      ok: false,
      diagnostic: { code: "command-owner-mismatch" },
    })
  })

  it("rejects duplicate queries and owner mismatches", () => {
    const alpha = moduleDescriptor("org.example.alpha")
    const beta = moduleDescriptor("org.example.beta")
    const alphaQuery = alpha.queries[0]
    const betaQuery = beta.queries[0]

    if (!alphaQuery || !betaQuery) {
      throw new Error("Module fixtures must expose query descriptors.")
    }

    const duplicate = {
      ...beta,
      queries: [{ ...betaQuery, kind: alphaQuery.kind }],
    }
    const wrongOwner = {
      ...alpha,
      queries: [{ ...alphaQuery, ownerModuleId: "org.example.beta" }],
    }

    expect(createModuleRegistry([alpha, duplicate])).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-query" },
    })
    expect(createModuleRegistry([wrongOwner])).toMatchObject({
      ok: false,
      diagnostic: { code: "query-owner-mismatch" },
    })
  })

  it("rejects missing dependencies and dependency cycles", () => {
    expect(
      createModuleRegistry([moduleDescriptor("org.example.alpha", ["org.example.beta"])]),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-module-dependency" },
    })

    const alpha = moduleDescriptor("org.example.alpha", ["org.example.beta"])
    const beta = moduleDescriptor("org.example.beta", ["org.example.alpha"])

    expect(createModuleRegistry([alpha, beta])).toMatchObject({
      ok: false,
      diagnostic: { code: "module-dependency-cycle" },
    })
  })
})
