/** Converts trusted resolution results to exact native keys within one owned topology snapshot. */
export function resolveSelectedEdgeKeys(
  candidateIds: readonly string[],
  transientShapeKeys: ReadonlyMap<string, number>,
): readonly number[] {
  if (candidateIds.length === 0 || candidateIds.length > 256)
    throw new Error("Invalid selected edge count.")
  const keys = candidateIds.map((id) => {
    const key = transientShapeKeys.get(id)
    if (key === undefined || !id.startsWith("edge:"))
      throw new Error("Selected edge is unavailable.")
    return key
  })
  if (new Set(keys).size !== keys.length)
    throw new Error("Selected edges resolve to duplicate native edges.")
  return keys
}
