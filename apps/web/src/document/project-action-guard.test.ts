import { describe, expect, it } from "vitest"
import { createProjectActionGuard, type ProjectActionBlock } from "./project-action-guard"

describe("mounted project action guard readers", () => {
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
