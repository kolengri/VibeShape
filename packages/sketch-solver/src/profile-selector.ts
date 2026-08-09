import type { SketchId } from "@vibeshape/domain/identifiers"
import {
  type SketchProfileSelector,
  sketchProfileSelectorSchema,
} from "@vibeshape/domain/sketch-profile-selector"
import type { SketchProfile, SketchProfileLoop, SketchProfileResult } from "./profiles"

export type SketchProfileResolution =
  | Readonly<{
      status: "resolved"
      profileIndex: number
      outerLoopIndex: number
      holeLoopIndices: readonly number[]
    }>
  | Readonly<{
      status: "missing"
      reason: "sketch-mismatch" | "profiles-unavailable" | "boundary-not-found"
    }>
  | Readonly<{ status: "ambiguous"; profileIndices: readonly number[] }>

function canonicalEntityIds(entityIds: readonly string[]) {
  return [...new Set(entityIds)].sort()
}

function canonicalHoleBoundaries(boundaries: readonly (readonly string[])[]) {
  return boundaries
    .map(canonicalEntityIds)
    .sort((left, right) => left.join(":").localeCompare(right.join(":")))
}

function loopAt(result: SketchProfileResult, loopIndex: number) {
  return result.loops.find((loop) => loop.loopIndex === loopIndex) ?? null
}

function boundariesForProfile(profile: SketchProfile, result: SketchProfileResult) {
  const outer = loopAt(result, profile.outerLoopIndex)
  const holes = profile.holeLoopIndices.map((loopIndex) => loopAt(result, loopIndex))
  if (!outer || holes.some((loop) => loop === null)) return null
  return {
    outerBoundaryEntityIds: canonicalEntityIds(outer.sourceEntityIds),
    holeBoundaryEntityIds: canonicalHoleBoundaries(
      holes.flatMap((loop) => (loop ? [loop.sourceEntityIds] : [])),
    ),
  }
}

function boundaryKey(boundaries: {
  outerBoundaryEntityIds: readonly string[]
  holeBoundaryEntityIds: readonly (readonly string[])[]
}) {
  return `${boundaries.outerBoundaryEntityIds.join(":")}|${boundaries.holeBoundaryEntityIds
    .map((hole) => hole.join(":"))
    .join("|")}`
}

function selectorKey(selector: SketchProfileSelector) {
  return boundaryKey({
    outerBoundaryEntityIds: selector.outerBoundaryEntityIds,
    holeBoundaryEntityIds: selector.holeBoundaryEntityIds,
  })
}

export function createSketchProfileSelector(
  sketchId: SketchId,
  result: SketchProfileResult,
  profileIndex: number,
): SketchProfileSelector | null {
  const profile = result.profiles.find((candidate) => candidate.profileIndex === profileIndex)
  if (!profile) return null
  const boundaries = boundariesForProfile(profile, result)
  if (!boundaries) return null
  const parsed = sketchProfileSelectorSchema.safeParse({
    schemaVersion: 0,
    sketchId,
    ...boundaries,
  })
  return parsed.success ? parsed.data : null
}

function resolvedProfile(profile: SketchProfile): SketchProfileResolution {
  return {
    status: "resolved",
    profileIndex: profile.profileIndex,
    outerLoopIndex: profile.outerLoopIndex,
    holeLoopIndices: profile.holeLoopIndices,
  }
}

export function resolveSketchProfileSelector(
  selector: SketchProfileSelector,
  sketchId: SketchId,
  result: SketchProfileResult,
): SketchProfileResolution {
  if (selector.sketchId !== sketchId) return { status: "missing", reason: "sketch-mismatch" }
  if (result.profiles.length === 0 && result.diagnostics.length > 0) {
    return { status: "missing", reason: "profiles-unavailable" }
  }
  const expectedKey = selectorKey(selector)
  const matches = result.profiles.filter((profile) => {
    const boundaries = boundariesForProfile(profile, result)
    return boundaries !== null && boundaryKey(boundaries) === expectedKey
  })
  if (matches.length === 0) return { status: "missing", reason: "boundary-not-found" }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      profileIndices: matches
        .map(({ profileIndex }) => profileIndex)
        .sort((left, right) => left - right),
    }
  }
  const match = matches[0]
  return match ? resolvedProfile(match) : { status: "missing", reason: "boundary-not-found" }
}

export function selectedProfileLoops(
  resolution: Extract<SketchProfileResolution, { status: "resolved" }>,
  result: SketchProfileResult,
): readonly SketchProfileLoop[] {
  const loopIndices = new Set([resolution.outerLoopIndex, ...resolution.holeLoopIndices])
  return result.loops.filter(({ loopIndex }) => loopIndices.has(loopIndex))
}
