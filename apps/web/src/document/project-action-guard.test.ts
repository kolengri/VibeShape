import { describe, expect, it } from "bun:test"
import { createProjectActionGuard, type ProjectActionBlock } from "./project-action-guard"

describe("mounted project action guard readers", () => {
  it("continues reading editor and surface blockers when a private reviewed commit excludes its own transport busy state", () => {
    const guard = createProjectActionGuard()
    guard.register(() => "automation-busy")
    let editor: ProjectActionBlock | null = "editor-draft"
    guard.register(() => editor)
    guard.register(() => "surface-texture-draft")
    const reviewed = () => guard.read((block) => block !== "automation-busy")
    expect(guard.read()).toBe("automation-busy")
    expect(reviewed()).toBe("editor-draft")
    editor = null
    expect(reviewed()).toBe("surface-texture-draft")
  })

  it("allows a captured private review to exclude automation busy while retaining all editor drafts", () => {
    const guard = createProjectActionGuard()
    guard.register(() => "automation-busy")
    const release = guard.register(() => "surface-texture-draft")
    expect(guard.read()).toBe("automation-busy")
    expect(guard.read((block) => block !== "automation-busy")).toBe("surface-texture-draft")
    release()
    expect(guard.read((block) => block !== "automation-busy")).toBeNull()
    expect(guard.read()).toBe("automation-busy")
  })
  it("reads current owner state without copying it and releases only its own registration", () => {
    const guard = createProjectActionGuard()
    let editor: ProjectActionBlock | null = "editor-draft"
    let ai: ProjectActionBlock | null = null
    const removeEditor = guard.register(() => editor)
    const removeAi = guard.register(() => ai)
    expect(guard.read()).toBe("editor-draft")
    editor = null
    expect(guard.read()).toBeNull()
    ai = "automation-busy"
    removeEditor()
    removeEditor()
    expect(guard.read()).toBe("automation-busy")
    removeAi()
    expect(guard.read()).toBeNull()
  })
})
