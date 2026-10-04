import type { ProjectOperation } from "./local-tools"
import { projectListSchema, projectViewSchema } from "./project-tools"

export function projectResultContextMatches(
  operation: ProjectOperation,
  result: { ok: boolean; value?: unknown },
  activeProjectId?: string,
) {
  if (!result.ok) return true
  if (operation.tool === "list_projects") {
    const parsed = projectListSchema.safeParse(result.value)
    if (!parsed.success) return false
    const { projects } = parsed.data
    return (
      (!activeProjectId || parsed.data.activeProjectId === activeProjectId) &&
      projects.length <= operation.arguments.limit &&
      projects.every(
        (project, index) =>
          (!operation.arguments.cursor || project.projectId > operation.arguments.cursor) &&
          (index === 0 || project.projectId > (projects[index - 1]?.projectId ?? "")),
      ) &&
      (parsed.data.nextCursor === null || parsed.data.nextCursor === projects.at(-1)?.projectId)
    )
  }
  const parsed = projectViewSchema.safeParse(result.value)
  if (
    !parsed.success ||
    (activeProjectId && operation.arguments.expectedProjectId !== activeProjectId)
  )
    return false
  return operation.tool === "open_project"
    ? parsed.data.projectId === operation.arguments.projectId
    : parsed.data.projectId !== operation.arguments.expectedProjectId &&
        parsed.data.name === operation.arguments.name
}
