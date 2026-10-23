import { beforeAll, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { measureVolume, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { resolveShellOpeningCandidates } from "../packages/application/src/shell-opening-resolution"
import { takeResolvedBodyFace } from "../packages/geometry-worker/src/occt-body-face"
import { inspectOcctBody } from "../packages/geometry-worker/src/occt-body-validation"
import { castOcctShape } from "../packages/geometry-worker/src/occt-cast"
import { pressPullOcctShape } from "../packages/geometry-worker/src/occt-press-pull"
import { createOcctCylinder } from "../packages/geometry-worker/src/occt-shapes"
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

describe("selected faces on curved bodies with real OCCT", () => {
  it.each(["shell", "press-pull"] as const)(
    "applies %s from a meshed face selection on a cold rebuild",
    (operation) => {
      for (const tolerance of [0.5, 0.05, 0.01]) {
        const displayed = createOcctCylinder(occt, 10, 20, [0, 0, 0])
        const rebuilt = createOcctCylinder(occt, 10, 20, [0, 0, 0])
        try {
          displayed.mesh({ tolerance, angularTolerance: 0.1 })
          const selection = captureReplicadTopologySnapshot(displayed).candidates.find(
            ({ kind, signature }) =>
              kind === "face" &&
              signature.geometryClass === "PLANE" &&
              Math.abs(signature.centroid[2] - 20) < 1e-7,
          )
          if (!selection) throw new Error("Fixture requires one top planar cap.")
          const face = takeResolvedBodyFace(
            rebuilt,
            captureReplicadTopologySnapshot(rebuilt),
            {
              schemaVersion: 1,
              kind: "face",
              outputRole: "result",
              signature: selection.signature,
            },
            { featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3302", outputRole: "result" },
            resolveShellOpeningCandidates,
          )
          try {
            const result =
              operation === "shell"
                ? createOcctShellOperations(castOcctShape).shellShape(
                    occt,
                    rebuilt,
                    [face.hashCode],
                    1,
                    "inward",
                  )
                : pressPullOcctShape(occt, rebuilt, face, 2)
            try {
              const metrics = inspectOcctBody(occt, result)
              expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
              expect(metrics.volume).toBeCloseTo(Math.PI * (operation === "shell" ? 461 : 2200), 5)
              expect(measureVolume(rebuilt)).toBeCloseTo(2000 * Math.PI, 5)
              expect(measureVolume(displayed)).toBeCloseTo(2000 * Math.PI, 5)
            } finally {
              result.delete()
            }
          } finally {
            face.delete()
          }
        } finally {
          rebuilt.delete()
          displayed.delete()
        }
      }
    },
  )
})
