import {
  canonicalJson,
  createDocumentDependencyGraphFromSnapshot,
  createSketchProfileSet,
  type DocumentSnapshot,
  readExtrusionProfileSet,
  readRevolveProfileSet,
  type revolveFeatureParametersSchema,
  type SketchId,
  type SketchProfileSelector,
  type TopoRef,
} from "@vibeshape/domain"
import type { ActivePartDesignTool } from "./part-design-tool"

export type ProfileFeatureTool = Extract<
  ActivePartDesignTool,
  {
    kind: "create-extrusion" | "edit-extrusion" | "create-revolve" | "edit-revolve"
  }
>

type ProfileSelectorIdentity = Readonly<{
  schemaVersion: number
  sketchId: string
  outerBoundaryEntityIds: readonly string[]
  holeBoundaryEntityIds: readonly (readonly string[])[]
}>
type RevolveAxis = ReturnType<typeof revolveFeatureParametersSchema.parse>["axis"]

export function isProfileFeatureTool(
  tool: ActivePartDesignTool | null,
): tool is ProfileFeatureTool {
  return Boolean(
    tool &&
      (tool.kind === "create-extrusion" ||
        tool.kind === "edit-extrusion" ||
        tool.kind === "create-revolve" ||
        tool.kind === "edit-revolve"),
  )
}

export function profileSelectorsEqual(
  left: ProfileSelectorIdentity | null,
  right: ProfileSelectorIdentity | null,
) {
  if (!left || !right) return left === right
  if (
    left.schemaVersion !== right.schemaVersion ||
    left.sketchId !== right.sketchId ||
    left.outerBoundaryEntityIds.length !== right.outerBoundaryEntityIds.length ||
    left.holeBoundaryEntityIds.length !== right.holeBoundaryEntityIds.length
  ) {
    return false
  }
  if (left.outerBoundaryEntityIds.some((id, index) => id !== right.outerBoundaryEntityIds[index])) {
    return false
  }
  return left.holeBoundaryEntityIds.every(
    (hole, holeIndex) =>
      hole.length === right.holeBoundaryEntityIds[holeIndex]?.length &&
      hole.every((id, entityIndex) => id === right.holeBoundaryEntityIds[holeIndex]?.[entityIndex]),
  )
}

export function nextProfileFeatureSelection(
  current: readonly SketchProfileSelector[],
  profile: SketchProfileSelector,
  intent: "replace" | "toggle",
): readonly SketchProfileSelector[] {
  if (intent === "replace" || current.some(({ sketchId }) => sketchId !== profile.sketchId)) {
    return [profile]
  }
  const matchingIndex = current.findIndex((candidate) => profileSelectorsEqual(candidate, profile))
  const profiles =
    matchingIndex < 0
      ? [...current, profile]
      : current.filter((_, index) => index !== matchingIndex)
  return profiles.length > 0 ? createSketchProfileSet(profiles).profiles : []
}

export function topologyReferencesEqual(left: TopoRef | null, right: TopoRef | null) {
  return canonicalJson(left) === canonicalJson(right)
}

export function revolveAxesEqual(left: RevolveAxis, right: RevolveAxis) {
  return canonicalJson(left) === canonicalJson(right)
}

export function profileFeatureToolKey(tool: ActivePartDesignTool | null) {
  if (!isProfileFeatureTool(tool)) return "inactive"
  if (tool.kind === "create-extrusion" || tool.kind === "create-revolve") {
    const profiles =
      tool.profiles.length > 0 ? createSketchProfileSet(tool.profiles).profiles : tool.profiles
    return `${tool.kind}:${canonicalJson(profiles)}`
  }
  return `${tool.kind}:${tool.featureId}`
}

export function profileForFeatureTool(
  tool: ActivePartDesignTool | null,
  snapshot: DocumentSnapshot | undefined,
): SketchProfileSelector | null {
  return profilesForFeatureTool(tool, snapshot)[0] ?? null
}

export function profilesForFeatureTool(
  tool: ActivePartDesignTool | null,
  snapshot: DocumentSnapshot | undefined,
): readonly SketchProfileSelector[] {
  if (!isProfileFeatureTool(tool)) return []
  if (tool.kind === "create-extrusion" || tool.kind === "create-revolve") return tool.profiles
  const feature = snapshot?.features.find(({ id }) => id === tool.featureId)
  if (!feature) return []
  const profileSet =
    tool.kind === "edit-extrusion"
      ? readExtrusionProfileSet(feature)
      : readRevolveProfileSet(feature)
  return profileSet?.profiles ?? []
}

export function initialProfileFeatureSelection(
  profiles: readonly SketchProfileSelector[],
  activeSketchId: SketchId | null,
): readonly SketchProfileSelector[] {
  if (!activeSketchId) return []
  const activeProfiles = profiles.filter(({ sketchId }) => sketchId === activeSketchId)
  return activeProfiles.length > 0 ? createSketchProfileSet(activeProfiles).profiles : []
}

export function profileSupportReference(
  snapshot: DocumentSnapshot,
  profile: SketchProfileSelector,
): TopoRef | undefined {
  return snapshot.sketches.find(({ id }) => id === profile.sketchId)?.support?.reference
}

export function revolveAxisAfterProfileSelection(
  axis: RevolveAxis | null,
  previousProfile: SketchProfileSelector | null,
  nextProfile: SketchProfileSelector,
): RevolveAxis | null {
  return axis?.kind === "sketch-line" && previousProfile?.sketchId !== nextProfile.sketchId
    ? { kind: "origin-axis", axis: "x" }
    : axis
}

export function ineligibleProfileSketchIds(
  snapshot: DocumentSnapshot,
  tool: ActivePartDesignTool | null,
): readonly SketchId[] {
  if (tool?.kind !== "edit-extrusion" && tool?.kind !== "edit-revolve") return []
  const graphResult = createDocumentDependencyGraphFromSnapshot(snapshot)
  if (!graphResult.ok) return snapshot.sketches.map(({ id }) => id)
  const featureIndex = graphResult.graph.history.findIndex(
    (ref) => ref.kind === "feature" && ref.id === tool.featureId,
  )
  if (featureIndex < 0) return snapshot.sketches.map(({ id }) => id)
  return graphResult.graph.history
    .slice(featureIndex + 1)
    .flatMap((ref) => (ref.kind === "sketch" ? [ref.id] : []))
}
