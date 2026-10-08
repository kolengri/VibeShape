import { describe, expect, it } from "bun:test"
import {
  assemblyDefinitionSchema,
  assemblyInstanceSchema,
  assemblyJointSchema,
} from "@vibeshape/domain/assembly"
import {
  captureAssemblyDefinition,
  emptyAssemblyAuthority,
  projectAssemblyAuthority,
} from "@vibeshape/domain/assembly-authority"
import { solveAssemblyKinematics } from "@vibeshape/domain/assembly-kinematics"
import { documentSnapshotV3Schema } from "@vibeshape/domain/document-v3"
import { documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import { prepareAuthorityTransaction } from "../../../../../packages/application/src/authority-transaction"
import { surfaceTextureProjectFixture } from "../../../../../tests/fixtures/surface-texture-project"
import { authoredTreeFixture, authoredTestId as id } from "../../test-support/authored-tree-fixture"
import {
  allAssemblyInterferencePairs,
  assemblyEulerDegrees,
  assemblyPoseFromEuler,
  attachAssemblyChildChanges,
  createAssemblyDefinitionChanges,
  createAssemblyTransaction,
  groundAssemblyInstanceChanges,
  identityAssemblyPose,
  newAssemblyInstance,
} from "./assembly-model"

function source() {
  const f = authoredTreeFixture()
  const part = f.authority.parts[0]
  const body = part?.bodyHistory[0]
  if (!part || !body) throw new Error("The assembly fixture requires an authored source Part.")
  return {
    name: part.name,
    source: { kind: "part" as const, partId: part.id, body, contentHash: "a".repeat(64) },
  }
}
function ids() {
  let next = 500
  return () => id(next++)
}
function definition() {
  return assemblyDefinitionSchema.parse({
    schemaVersion: 1,
    id: id(600),
    name: "Bracket",
    sources: [source().source],
    sourceFrame: identityAssemblyPose,
  })
}
describe("Assembly UI command intent", () => {
  it("captures an exact source declaration and independent definition/instance identities in one atomic change", () => {
    const selected = source()
    const before = structuredClone(selected)
    const changes = createAssemblyDefinitionChanges(
      selected,
      "Bracket",
      "Bracket occurrence",
      ids(),
    )
    expect(changes).toMatchObject([
      { kind: "definition.create", definition: { id: id(500), sources: [before.source] } },
      { kind: "instance.create", instance: { id: id(501), definitionId: id(500), grounded: true } },
    ])
    expect(selected).toEqual(before)
    expect(new Set([selected.source.partId, id(500), id(501)]).size).toBe(3)
  })
  it("upgrades V2 and publishes the whole assembly change using successive command revisions", () => {
    const changes = createAssemblyDefinitionChanges(
      source(),
      "Bracket",
      "Bracket occurrence",
      ids(),
    )
    const transaction = createAssemblyTransaction(
      { documentId: id(1), revision: 7, authorityVersion: 2 },
      changes,
      ids(),
    )
    expect(transaction.commands.map(({ kind, baseRevision }) => [kind, baseRevision])).toEqual([
      ["org.vibeshape.document.upgrade-v3", 7],
      ["org.vibeshape.document.upgrade-v4", 8],
      ["org.vibeshape.document.assembly-command", 9],
    ])
    expect(transaction.commands[2]?.payload).toEqual<unknown>({ changes })
    expect(transaction.assetBlobs).toEqual([])
    const v3 = createAssemblyTransaction(
      { documentId: id(1), revision: 9, authorityVersion: 3 },
      changes,
      ids(),
    )
    expect(v3.commands.map(({ kind, baseRevision }) => [kind, baseRevision])).toEqual([
      ["org.vibeshape.document.upgrade-v4", 9],
      ["org.vibeshape.document.assembly-command", 10],
    ])
    const v4 = createAssemblyTransaction(
      { documentId: id(1), revision: 11, authorityVersion: 4 },
      changes,
      ids(),
    )
    expect(v4.commands).toHaveLength(1)
    expect(v4.commands[0]).toMatchObject({ baseRevision: 11, schemaVersion: 4 })
  })
  it("rejects capturing a textured V3 source atomically without dropping its texture authority", () => {
    const textured = surfaceTextureProjectFixture()
    const base = documentSnapshotV3Schema.parse({
      ...textured.snapshot,
      schemaVersion: 3,
      surfaceTextures: [textured.layer],
    })
    const part = base.parts[0]
    const body = part?.bodyHistory[0]
    if (!part || !body) throw new Error("The textured fixture requires a source Part.")
    const before = structuredClone(base)
    const changes = createAssemblyDefinitionChanges(
      {
        name: part.name,
        source: { kind: "part", partId: part.id, body, contentHash: "a".repeat(64) },
      },
      "Housing",
      "Housing occurrence",
      ids(),
    )
    const transaction = createAssemblyTransaction(
      { documentId: base.id, revision: base.revision, authorityVersion: 3 },
      changes,
      ids(),
    )
    const committed = prepareAuthorityTransaction(base, transaction, () => {
      throw new Error("Assembly must not allocate an authored Part.")
    })
    expect(committed).toMatchObject({ ok: false })
    if (committed.ok) throw new Error("Textured source capture must fail closed.")
    expect(committed.diagnostic.message).toContain("textured")
    expect(base).toEqual(before)
  })
  it("rejects malformed intent before allocating command identities", () => {
    let allocated = 0
    expect(() =>
      createAssemblyTransaction({ documentId: id(1), revision: 1, authorityVersion: 3 }, [], () => {
        allocated++
        return id(800)
      }),
    ).toThrow()
    expect(allocated).toBe(0)
  })
  it("converts right-handed XYZ degrees to canonical quaternions without changing translation", () => {
    const pose = assemblyPoseFromEuler([12, -4, 7], [90, 0, 90])
    expect(pose.translation).toEqual([12, -4, 7])
    for (const component of pose.quaternion) expect(component).toBeCloseTo(0.5, 14)
    expect(assemblyPoseFromEuler([0, 0, 0], [0, 0, 360]).quaternion[3]).toBeCloseTo(1, 14)
    expect(() => assemblyPoseFromEuler([Infinity, 0, 0], [0, 0, 0])).toThrow()
    expect(() => assemblyPoseFromEuler([0, 0, 0], [NaN, 0, 0])).toThrow()
    expect(() => assemblyPoseFromEuler([0, 0, 0], [361, 0, 0])).toThrow()
  })
  it.each(
    [
      [20, 90, -45],
      [25, -90, 60],
      [30, 40, -70],
    ].map((angles) => ({ angles })),
  )("round-trips edit fields at and away from gimbal lock %j", ({ angles }) => {
    const original = assemblyPoseFromEuler([3, 4, 5], angles as [number, number, number])
    const edited = assemblyPoseFromEuler(original.translation, assemblyEulerDegrees(original))
    original.quaternion.forEach((component, index) => {
      expect(edited.quaternion[index]).toBeCloseTo(component, 12)
    })
  })
  it("creates child and joint atomically, then grounds the child without moving its solved world frame", () => {
    const f = authoredTreeFixture()
    const def = captureAssemblyDefinition(
      documentSnapshotV4Schema.parse({
        ...f.authority,
        schemaVersion: 4,
        surfaceTextures: [],
        assets: [],
      }),
      definition(),
      1,
    )
    const parent = newAssemblyInstance(
      def,
      "Parent",
      assemblyPoseFromEuler([10, 0, 0], [0, 0, 90]),
      () => id(601),
    )
    const child = newAssemblyInstance(def, "Child", identityAssemblyPose, () => id(602))
    const joint = assemblyJointSchema.parse({
      schemaVersion: 1,
      id: id(603),
      kind: "prismatic",
      parentInstanceId: parent.id,
      childInstanceId: child.id,
      parentFrame: identityAssemblyPose,
      childFrame: identityAssemblyPose,
      axis: [1, 0, 0],
      value: 5,
      limits: { min: 0, max: 10 },
    })
    const changes = attachAssemblyChildChanges(child, joint, true)
    expect(changes.map(({ kind }) => kind)).toEqual(["instance.create", "joint.create"])
    const instance = changes[0]?.kind === "instance.create" ? changes[0].instance : null
    if (!instance) throw new Error("The attached child is required.")
    expect(instance).not.toHaveProperty("worldFrame")
    const assembly = {
      ...emptyAssemblyAuthority(),
      definitions: [def],
      instances: [parent, instance],
      joints: [joint],
    }
    const before = structuredClone(assembly)
    const grounded = groundAssemblyInstanceChanges(assembly, instance)
    expect(grounded[0]).toEqual({ kind: "joint.remove", jointId: joint.id })
    const update = grounded[1]
    if (update?.kind !== "instance.update" || !update.instance.grounded)
      throw new Error("A grounded update is required.")
    expect(update.instance.id).toBe(child.id)
    expect(update.instance.worldFrame.translation[0]).toBeCloseTo(10, 12)
    expect(update.instance.worldFrame.translation[1]).toBeCloseTo(5, 12)
    const solved = solveAssemblyKinematics(
      projectAssemblyAuthority({
        ...assembly,
        joints: [],
        instances: [parent, update.instance],
      }),
    )
    expect(solved.ok).toBe(true)
    expect(assembly).toEqual(before)
    expect(() =>
      attachAssemblyChildChanges(child, { ...joint, childInstanceId: parent.id }, true),
    ).toThrow()
  })
  it("generates unique unordered pairs within the advertised all-instance budget", () => {
    const instances = Array.from({ length: 32 }, (_, index) =>
      assemblyInstanceSchema.parse({
        schemaVersion: 1,
        id: id(700 + index),
        definitionId: id(600),
        name: `Instance ${index}`,
        grounded: true,
        worldFrame: identityAssemblyPose,
      }),
    )
    const pairs = allAssemblyInterferencePairs(instances)
    expect(pairs).toHaveLength(496)
    expect(
      new Set(
        pairs.map(({ leftInstanceId, rightInstanceId }) =>
          [leftInstanceId, rightInstanceId].sort().join(":"),
        ),
      ).size,
    ).toBe(496)
    expect(() =>
      allAssemblyInterferencePairs([...instances, instances[0] as (typeof instances)[number]]),
    ).toThrow(/32/)
  })
})
