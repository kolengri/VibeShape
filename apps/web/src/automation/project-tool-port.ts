import {
  localFailure,
  localToolOutputs,
  type ProjectOperation,
} from "@vibeshape/automation-api/local-tools"
import type { CommandActor } from "@vibeshape/domain/commands"
import {
  createAutomationProject,
  listLocalProjects,
  openAutomationProject,
} from "../document/document-controller"

export type ProjectToolPort = Readonly<{
  execute: (operation: ProjectOperation, signal?: AbortSignal) => Promise<unknown>
}>

// The browser grant belongs to the live transport, never to a model-supplied payload.
export function createProjectToolPort(options: {
  actor?: CommandActor
  isAllowed: () => boolean
  readIdentity: () => { id: string; name: string; revision: number } | null
  replaceSession: () => boolean
}): ProjectToolPort {
  function interrupted(signal?: AbortSignal) {
    return !options.isAllowed() || signal?.aborted === true
  }
  async function list(
    operation: Extract<ProjectOperation, { tool: "list_projects" }>,
    activeProjectId: string,
    signal?: AbortSignal,
  ) {
    const listed = await listLocalProjects()
    if (interrupted(signal))
      return localFailure("request-cancelled", "The project request was cancelled.")
    if (!listed.ok) return localFailure(listed.diagnostic.code, listed.diagnostic.message, true)
    if (options.readIdentity()?.id !== activeProjectId)
      return localFailure("document-changed", "The paired project changed during listing.")
    const sorted = [...listed.projects].sort((left, right) =>
      left.documentId.localeCompare(right.documentId),
    )
    const { cursor, limit } = operation.arguments
    const projects = sorted.filter((project) => !cursor || project.documentId > cursor)
    const page = projects.slice(0, limit)
    return localToolOutputs.list_projects.parse({
      ok: true,
      value: {
        activeProjectId,
        projects: page.map((project) => ({
          projectId: project.documentId,
          name: project.name,
          revision: project.headRevision,
          updatedAt: project.updatedAt,
        })),
        nextCursor: projects.length > limit ? (page.at(-1)?.documentId ?? null) : null,
      },
    })
  }
  async function change(
    operation: Exclude<ProjectOperation, { tool: "list_projects" }>,
    identity: { id: string; revision: number },
    signal?: AbortSignal,
  ) {
    const expected = {
      documentId: operation.arguments.expectedProjectId,
      revision: operation.arguments.expectedRevision,
    }
    if (identity.id !== expected.documentId || identity.revision !== expected.revision)
      return localFailure("stale-project", "Read model_info again before changing projects.")
    const result =
      operation.tool === "create_project"
        ? await createAutomationProject(operation.arguments.name, expected, signal, options.actor)
        : await openAutomationProject(operation.arguments.projectId, expected, signal)
    if (interrupted(signal))
      return localFailure(
        "outcome-unknown",
        "The project action was interrupted. Inspect the active project before retrying.",
      )
    const current = options.readIdentity()
    // A failed close can reopen the source project with a different underlying session.
    if (
      (!current || (result.ok && result.value.projectId !== identity.id)) &&
      !options.replaceSession()
    )
      return localFailure(
        "outcome-unknown",
        "The project connection could not be refreshed. Inspect the active project before retrying.",
      )
    return result
  }
  return {
    async execute(operation, signal) {
      if (!options.isAllowed())
        return localFailure(
          "project-management-disabled",
          "Enable Allow project management in the browser AI connection settings.",
        )
      if (signal?.aborted)
        return localFailure("request-cancelled", "The project request was cancelled.")
      const identity = options.readIdentity()
      if (!identity)
        return localFailure("document-unavailable", "The paired project is unavailable.", true)
      if (operation.tool === "list_projects") return list(operation, identity.id, signal)
      return change(operation, identity, signal)
    },
  }
}
