type Resource = Readonly<{
  isBusy: () => boolean
  dispose: () => void | Promise<void>
}>
const resources = new Map<string, Set<Resource>>()

export function registerProjectRuntimeResource(projectId: string, resource: Resource) {
  let current = resources.get(projectId)
  if (!current) {
    current = new Set()
    resources.set(projectId, current)
  }
  current.add(resource)
  return () => {
    current.delete(resource)
    if (!current.size && resources.get(projectId) === current) resources.delete(projectId)
  }
}

export function isProjectRuntimeResourceBusy(projectId: string) {
  return [...(resources.get(projectId) ?? [])].some((resource) => resource.isBusy())
}

export async function disposeProjectRuntimeResources(projectId: string) {
  const current = resources.get(projectId)
  if (!current) return
  await Promise.all([...current].map((resource) => resource.dispose()))
  if (resources.get(projectId) === current) resources.delete(projectId)
}
