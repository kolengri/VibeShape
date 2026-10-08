import { beforeAll, describe, expect, it } from "bun:test"
import { assemblyMateGraphSchema } from "@vibeshape/domain/assembly-mates"
import { assemblyRigidPoseWireSchema, topologyCandidatesSchema } from "@vibeshape/protocol"
import { makeBox, makeCylinder, makeSphere, measureVolume, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { matchValue } from "../../../tests/unit/support/match-value"
import { measureOcctInterference } from "../../geometry-worker/src/occt-interference"
import { captureReplicadTopologyCandidates } from "../../geometry-worker/src/topology-signatures"
import createNativeSolver from "../../sketch-solver/runtime/vibeshape_slvs.mjs"
import type { NativeSketchSolverModule } from "../../sketch-solver/src/abi"
import { solveAssemblyConstraints } from "../../sketch-solver/src/assembly"

let occt: OpenCascadeInstance, solver: NativeSketchSolverModule
beforeAll(async () => {
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    {
      locateFile: () =>
        new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)
          .pathname,
    },
  ])
  setOC(occt)
  solver = await createNativeSolver({
    locateFile: () =>
      new URL("../../sketch-solver/runtime/vibeshape_slvs.wasm", import.meta.url).pathname,
  })
}, 60_000)
const id = (n: number) => `018f0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`
const pose = (x = 0) => ({ translation: [x, 0, 0], quaternion: [0, 0, 0, 1] })

describe("native general assembly analytical placement", () => {
  it("captures exact planar, cylindrical and spherical frames without persisting transient indices", () => {
    const shapes = [
      makeBox([0, 0, 0], [2, 3, 4]),
      makeCylinder(2, 4, [3, 4, 5], [0, 1, 0]),
      makeSphere(2),
    ]
    try {
      const candidates = shapes.map((shape) =>
        topologyCandidatesSchema.parse(captureReplicadTopologyCandidates(shape)),
      )
      const planes = required(candidates[0]).filter(
        (c) => c.referenceGeometry?.kind === "plane-face",
      )
      expect(planes).toHaveLength(6)
      for (const plane of planes)
        if (plane.referenceGeometry?.kind === "plane-face")
          expect(Math.hypot(...plane.referenceGeometry.normal)).toBeCloseTo(1, 12)
      const cylinder = required(candidates[1]).find(
        (c) => c.referenceGeometry?.kind === "cylinder-face",
      )?.referenceGeometry
      expect(cylinder).toMatchObject({
        kind: "cylinder-face",
        origin: [3, 4, 5],
        axis: [0, 1, 0],
        radius: 2,
      })
      const sphere = required(candidates[2]).find(
        (c) => c.referenceGeometry?.kind === "sphere-face",
      )?.referenceGeometry
      expect(sphere).toMatchObject({ kind: "sphere-face", center: [0, 0, 0], radius: 2 })
      // Repeated extraction owns and disposes its temporary OCCT adaptors; source solids remain valid.
      for (let iteration = 0; iteration < 20; iteration++)
        for (const shape of shapes)
          expect(captureReplicadTopologyCandidates(shape).length).toBeGreaterThan(0)
      expect(measureVolume(required(shapes[0]))).toBeCloseTo(24, 10)
    } finally {
      for (const shape of shapes) shape.delete()
    }
  })
  it("applies a nonzero definition source frame once to redundant-consistent mates and exact interference", () => {
    const definition = {
      schemaVersion: 1,
      id: id(1),
      name: "Block",
      sourceFrame: pose(10),
      sources: [
        {
          kind: "part",
          partId: id(2),
          body: { schemaVersion: 0, featureId: id(3), outputRole: "result" },
          contentHash: "a".repeat(64),
        },
      ],
    }
    const mate = (n: number, x: number) => ({
      schemaVersion: 2,
      id: id(n),
      kind: "fixed",
      parentInstanceId: id(10),
      childInstanceId: id(11),
      parentFrame: pose(x),
      childFrame: pose(),
    })
    const graph = assemblyMateGraphSchema.parse({
      schemaVersion: 2,
      definitions: [definition],
      instances: [
        {
          schemaVersion: 2,
          id: id(10),
          definitionId: id(1),
          name: "Anchor",
          grounded: true,
          worldFrame: pose(10),
        },
        {
          schemaVersion: 2,
          id: id(11),
          definitionId: id(1),
          name: "Moving",
          grounded: false,
          initialFrame: pose(11),
        },
      ],
      joints: [mate(20, 1), mate(21, 1)],
    })
    const result = solveAssemblyConstraints(solver, graph)
    expect(result).toMatchObject({ ok: true, degreesOfFreedom: 0, redundant: true })
    if (!result.ok) throw new Error(result.message)
    expect(result.instances[0]?.geometryFrame.translation[0]).toBeCloseTo(0, 8)
    expect(result.instances[1]?.geometryFrame.translation[0]).toBeCloseTo(1, 8)
    const shape = makeBox([0, 0, 0], [2, 3, 4])
    try {
      const interference = measureOcctInterference(
        occt,
        [
          {
            shape,
            pose: assemblyRigidPoseWireSchema.parse(required(result.instances[0]).geometryFrame),
          },
        ],
        [
          {
            shape,
            pose: assemblyRigidPoseWireSchema.parse(required(result.instances[1]).geometryFrame),
          },
        ],
      )
      expect(matchValue(interference)).toMatchObject({
        solidCount: 1,
        volume: expect.closeTo(12, 8),
      })
      expect(measureVolume(shape)).toBeCloseTo(24, 10)
      required(graph.joints[1]).parentFrame = assemblyMateGraphSchema.shape.joints.element.parse(
        mate(21, 2),
      ).parentFrame
      const failure = solveAssemblyConstraints(solver, graph)
      expect(failure).toMatchObject({ ok: false, code: "conflicting-mates" })
      expect(failure).not.toHaveProperty("instances")
    } finally {
      shape.delete()
    }
  })
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture evidence is missing.")
  return value
}
