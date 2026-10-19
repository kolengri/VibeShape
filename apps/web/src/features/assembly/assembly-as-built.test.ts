import { describe, expect, it } from "bun:test"
import type { AssemblyRigidPose } from "@vibeshape/domain/assembly"
import {
  applyCapturedAssemblyMutations,
  projectAssemblyAuthority,
} from "@vibeshape/domain/assembly-authority"
import { solveAssemblyKinematics } from "@vibeshape/domain/assembly-kinematics"
import { composeAssemblyPoses } from "@vibeshape/domain/assembly-poses"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { asBuiltJointChanges, captureAsBuiltPoses, rigidGroupChanges } from "./assembly-as-built"
import { asBuiltUiFixture as fixture } from "./assembly-as-built-test-fixture"
import { assemblyPoseFromEuler } from "./assembly-model"

function closePose(actual: AssemblyRigidPose, expected: AssemblyRigidPose) {
  actual.translation.forEach((v, i) => {
    expect(v).toBeCloseTo(expected.translation[i] ?? 0, 8)
  })
  actual.quaternion.forEach((v, i) => {
    expect(v).toBeCloseTo(expected.quaternion[i] ?? 0, 8)
  })
}
function uuids() {
  let n = 700
  return () => id(n++)
}

describe("pose-preserving assembly authoring", () => {
  it("captures occurrence world poses with a nonzero definition source frame exactly once", () => {
    const f = fixture()
    expect(f.capture.documentKey).toBe(`${id(1)}:7`)
    f.capture.poses.forEach((pose, index) => {
      const expected = f.frames[index]
      if (!expected) throw new Error("Missing expected frame.")
      closePose(pose.worldFrame, expected)
    })
  })
  it("constructs local frames from one captured world frame without moving either occurrence", () => {
    const f = fixture()
    const changes = asBuiltJointChanges(
      f.assembly,
      f.capture,
      { parentId: id(510), childId: id(511), kind: "fixed" },
      uuids(),
    )
    const created = changes.find((change) => change.kind === "joint.create")
    if (created?.kind !== "joint.create") throw new Error("Missing created mate.")
    expect(created.joint.parentFrame.translation[0]).toBeCloseTo(6, 8)
    expect(created.joint.parentFrame.translation[1]).toBeCloseTo(-4, 8)
    expect(created.joint.parentFrame.translation[2]).toBeCloseTo(2, 8)
    const next = applyCapturedAssemblyMutations(f.assembly, changes)
    const solved = solveAssemblyKinematics(projectAssemblyAuthority(next))
    if (!solved.ok) throw new Error(solved.diagnostic.message)
    solved.instances.forEach((pose) => {
      const expected = f.capture.poses.find(({ instanceId }) => instanceId === pose.instanceId)
      if (!expected) throw new Error("Missing expected occurrence.")
      closePose(pose.worldFrame, expected.worldFrame)
    })
    expect(next.schemaVersion).toBe(1)
    expect(next.instances.filter(({ grounded }) => grounded)).toHaveLength(2)
  })
  it.each(["fixed", "revolute", "prismatic", "cylindrical", "ball"] as const)(
    "preserves the solved branch and zero coordinate for a general %s mate",
    (kind) => {
      const f = fixture(2)
      const before = structuredClone(f.assembly)
      const changes = asBuiltJointChanges(
        f.assembly,
        f.capture,
        { parentId: id(510), childId: id(511), kind },
        uuids(),
      )
      const next = applyCapturedAssemblyMutations(f.assembly, changes)
      const child = next.instances.find(({ id: value }) => value === id(511))
      const joint = next.joints[0]
      const parentPose = f.frames[0],
        childPose = f.frames[1]
      if (
        !child ||
        child.grounded ||
        child.schemaVersion !== 2 ||
        !joint ||
        !parentPose ||
        !childPose
      )
        throw new Error("Expected a captured free child and mate.")
      closePose(child.initialFrame, childPose)
      closePose(
        composeAssemblyPoses(parentPose, joint.parentFrame),
        composeAssemblyPoses(childPose, joint.childFrame),
      )
      if (joint.kind === "revolute" || joint.kind === "prismatic") expect(joint.value).toBe(0)
      expect(f.assembly).toEqual(before)
    },
  )
  it("builds one fixed star batch in stable member order and preserves placement when its anchor moves", () => {
    const f = fixture()
    const changes = rigidGroupChanges(
      f.assembly,
      f.capture,
      id(510),
      [id(512), id(510), id(511)],
      uuids(),
    )
    expect(
      changes
        .filter((change) => change.kind === "joint.create")
        .map((change) =>
          change.kind === "joint.create" ? String(change.joint.childInstanceId) : null,
        ),
    ).toEqual([id(511), id(512)])
    const next = applyCapturedAssemblyMutations(f.assembly, changes)
    expect(next.instances.filter(({ grounded }) => grounded).map(({ id }) => String(id))).toEqual([
      id(510),
    ])
    const anchor = next.instances.find(({ id: value }) => value === id(510))
    if (!anchor?.grounded) throw new Error("Missing group anchor.")
    const moved = applyCapturedAssemblyMutations(next, [
      {
        kind: "instance.update",
        instance: { ...anchor, worldFrame: assemblyPoseFromEuler([100, 0, 0], [0, 0, 0]) },
      },
    ])
    const solved = solveAssemblyKinematics(projectAssemblyAuthority(moved))
    if (!solved.ok) throw new Error(solved.diagnostic.message)
    const child = solved.instances.find(({ instanceId }) => instanceId === id(511))
    expect(child?.worldFrame.translation[0]).toBeCloseTo(106, 8)
    expect(child?.worldFrame.translation[1]).toBeCloseTo(-4, 8)
    expect(child?.worldFrame.translation[2]).toBeCloseTo(2, 8)
  })
  it("rejects stale or missing source poses and invalid group membership without mutating authority", () => {
    const f = fixture()
    const before = structuredClone(f.assembly)
    expect(() =>
      captureAsBuiltPoses(f.assembly, { ...f.inspection, occurrences: [] }, "current"),
    ).toThrow()
    expect(() =>
      captureAsBuiltPoses(
        f.assembly,
        {
          ...f.inspection,
          occurrences: f.inspection.occurrences.map((occurrence) => ({
            ...occurrence,
            pinRevision: occurrence.pinRevision + 1,
          })),
        },
        "current",
      ),
    ).toThrow()
    for (const ids of [[id(510)], [id(510), id(510)], [id(511), id(512)], [id(510), id(999)]])
      expect(() => rigidGroupChanges(f.assembly, f.capture, id(510), ids, uuids())).toThrow()
    expect(() =>
      asBuiltJointChanges(
        f.assembly,
        f.capture,
        { parentId: id(510), childId: id(510), kind: "fixed" },
        uuids(),
      ),
    ).toThrow()
    expect(f.assembly).toEqual(before)
  })
  it("preserves version-one graph restrictions instead of silently upgrading or replacing an inbound mate", () => {
    const f = fixture()
    expect(() =>
      asBuiltJointChanges(
        f.assembly,
        f.capture,
        { parentId: id(510), childId: id(511), kind: "ball" },
        uuids(),
      ),
    ).toThrow()
    const changes = asBuiltJointChanges(
      f.assembly,
      f.capture,
      { parentId: id(510), childId: id(511), kind: "fixed" },
      uuids(),
    )
    const next = applyCapturedAssemblyMutations(f.assembly, changes)
    expect(() =>
      applyCapturedAssemblyMutations(
        next,
        asBuiltJointChanges(
          next,
          f.capture,
          { parentId: id(512), childId: id(511), kind: "fixed" },
          uuids(),
        ),
      ),
    ).toThrow()
  })
})
