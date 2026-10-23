import { beforeAll, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { type Face, measureVolume, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { resolveShellOpeningCandidates } from "../packages/application/src/shell-opening-resolution"
import { takeResolvedBodyFace } from "../packages/geometry-worker/src/occt-body-face"
import { inspectOcctBody } from "../packages/geometry-worker/src/occt-body-validation"
import { castOcctShape } from "../packages/geometry-worker/src/occt-cast"
import { pressPullOcctShape } from "../packages/geometry-worker/src/occt-press-pull"
import { createOcctCylinder, cutOcctShapes } from "../packages/geometry-worker/src/occt-shapes"
import { createOcctShellOperations } from "../packages/geometry-worker/src/occt-shell"
import { captureReplicadTopologySnapshot } from "../packages/geometry-worker/src/topology-signatures"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const wasmBinary = readFileSync(
    new URL(
      "../packages/geometry-worker/node_modules/replicad-opencascadejs/src/replicad_single.wasm",
      import.meta.url,
    ),
  )
  occt = await Reflect.apply(initializeOpenCascade, undefined, [{ wasmBinary }])
  setOC(occt)
})

function groovedTube() {
  const owned: Shape3D[] = []
  const cylinder = (radius: number, height: number, z = 0) => {
    const shape = createOcctCylinder(occt, radius, height, [0, 0, z])
    owned.push(shape)
    return shape
  }
  try {
    const tube = cutOcctShapes(occt, cylinder(33.3, 10), cylinder(31.6, 10))
    owned.push(tube)
    const groove = cutOcctShapes(occt, cylinder(32.5, 2, 9), cylinder(32.4, 2, 9))
    owned.push(groove)
    return cutOcctShapes(occt, tube, groove)
  } finally {
    for (const shape of owned.reverse()) shape.delete()
  }
}

function takeFixtureFace(source: Shape3D, key: number) {
  const faces = source.faces
  const selected = faces.find((face) => face.hashCode === key)
  for (const face of faces) if (face !== selected) face.delete()
  if (!selected) throw new Error("Fixture requires its current native face.")
  return selected
}

function applyFaceOperation(source: Shape3D, face: Face, operation: "shell" | "press-pull") {
  return operation === "shell"
    ? createOcctShellOperations(castOcctShape).shellShape(
        occt,
        source,
        [face.hashCode],
        0.02,
        "inward",
      )
    : pressPullOcctShape(occt, source, face, 0.1)
}

describe("unique coplanar annular face selection with real OCCT", () => {
  for (const areaFactor of [51.2, 52.64]) {
    it.each(["shell", "press-pull"] as const)(
      `applies %s to the unchanged ${areaFactor}π top land beside a similar land`,
      (operation) => {
        const source = groovedTube()
        try {
          const snapshot = captureReplicadTopologySnapshot(source)
          const lands = snapshot.candidates.filter(
            ({ kind, signature }) =>
              kind === "face" &&
              signature.geometryClass === "PLANE" &&
              Math.abs(signature.centroid[2] - 10) < 1e-7,
          )
          expect(lands).toHaveLength(2)
          const picked = lands.find(
            ({ signature }) => Math.abs(signature.measure - areaFactor * Math.PI) < 1e-6,
          )
          const key = picked ? snapshot.transientShapeKeys.get(picked.candidateId) : undefined
          if (!picked || key === undefined) throw new Error("Fixture requires the selected land.")
          const sourceVolume = measureVolume(source)
          const nativeFace = takeFixtureFace(source, key)
          let expectedVolume: number
          try {
            const admissible = applyFaceOperation(source, nativeFace, operation)
            try {
              const metrics = inspectOcctBody(occt, admissible)
              expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
              expect(metrics.volume).toBeGreaterThan(0)
              if (operation === "press-pull")
                expect(metrics.volume).toBeCloseTo(sourceVolume + areaFactor * Math.PI * 0.1, 5)
              else expect(metrics.volume).toBeLessThan(sourceVolume)
              expectedVolume = metrics.volume
            } finally {
              admissible.delete()
            }
          } finally {
            nativeFace.delete()
          }
          const resolved = takeResolvedBodyFace(
            source,
            snapshot,
            { schemaVersion: 1, kind: "face", outputRole: "result", signature: picked.signature },
            { featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3302", outputRole: "result" },
            resolveShellOpeningCandidates,
          )
          try {
            const result = applyFaceOperation(source, resolved, operation)
            try {
              const metrics = inspectOcctBody(occt, result)
              expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
              expect(metrics.volume).toBeCloseTo(expectedVolume, 6)
              expect(measureVolume(source)).toBeCloseTo(sourceVolume, 6)
            } finally {
              result.delete()
            }
          } finally {
            resolved.delete()
          }
        } finally {
          source.delete()
        }
      },
    )
  }
})
