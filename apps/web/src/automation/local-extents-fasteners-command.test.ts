import { describe, expect, it } from "bun:test"
import { type LocalOperation, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, parseDocumentCommand } from "@vibeshape/domain"
import { extrusionFeatureTypeV6, extrusionFeatureTypeV7 } from "@vibeshape/domain/part-design"
import { holeFeatureTypeV3 } from "@vibeshape/domain/part-design-hole"
import { threadFeatureTypeV2 } from "@vibeshape/domain/part-design-thread"
import {
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
} from "@vibeshape/domain/units"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const body = { schemaVersion: 0, featureId: id(1), outputRole: "pattern.instance.1" }
const base = {
  draftId: id(10),
  baseRevision: 7,
  commandId: id(11),
  featureId: id(12),
  dependencies: [id(1)],
  references: [],
  suppressed: false,
}
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(50),
})
const extrude = {
  profiles: {
    schemaVersion: 0,
    profiles: [
      {
        schemaVersion: 0,
        sketchId: id(2),
        outerBoundaryEntityIds: [id(3)],
        holeBoundaryEntityIds: [],
      },
    ],
  },
  distance: createLengthQuantity(8),
  symmetric: false,
  reversed: true,
  secondDistance: null,
  operation: "remove",
  targetBody: body,
  startOffset: createLengthQuantity(-2, "mm", "#offset"),
  draftAngle: createAngleQuantity(-2, "deg"),
  endCondition: { kind: "through-all", targetBody: body, sourceContentHash: "a".repeat(64) },
}
const faceExtrude = {
  ...extrude,
  endCondition: {
    kind: "up-to-face",
    targetBody: body,
    sourceContentHash: "a".repeat(64),
    face: {
      schemaVersion: 1,
      featureId: body.featureId,
      outputRole: body.outputRole,
      kind: "face",
      signature: {
        kind: "face",
        geometryClass: "SPHERE",
        measure: 64 * Math.PI,
        centroid: [0, 0, 8],
        bounds: { min: [-4, -4, 4], max: [4, 4, 12] },
        boundaryCount: 1,
        adjacentGeometryClasses: [],
      },
    },
  },
}
const hole = {
  sketchId: id(2),
  pointIds: [id(4), id(3)],
  diameter: createLengthQuantity(2),
  direction: "forward",
  extent: "blind",
  depth: createLengthQuantity(8),
  targetBody: body,
  treatment: {
    kind: "counterbore",
    diameter: createLengthQuantity(4),
    depth: createLengthQuantity(1, "mm", "#recess"),
  },
}
const thread = {
  targetBody: body,
  kind: "external",
  axis: { kind: "datum-axis", featureId: id(2), axis: "normal" },
  handedness: "left",
  nominalDiameter: createLengthQuantity(10),
  pitch: createLengthQuantity(2, "mm", "#pitch"),
  length: createLengthQuantity(40),
  depth: createLengthQuantity(0.8),
  clearance: createLengthQuantity(0.1),
  starts: createScalarQuantity(1),
  phase: createAngleQuantity(12, "deg"),
  runIn: createLengthQuantity(0),
  runOut: createLengthQuantity(0),
}

function advancedCommand(operation: LocalOperation) {
  switch (operation.tool) {
    case "create_face_extent_extrude":
    case "update_face_extent_extrude":
    case "create_extrude":
    case "update_extrude":
    case "create_hole":
    case "update_hole":
    case "create_thread":
    case "update_thread":
      return createLocalCadCommand(operation, actor, id(60))
    default:
      throw new Error("Expected advanced CAD command.")
  }
}

describe("versioned extent and fastener MCP commands", () => {
  it.each(["create", "update"] as const)(
    "preserves all %s feature intent through the owned draft envelope",
    (action) => {
      for (const [suffix, parameters, dependencies, type] of [
        ["extrude", extrude, [id(1)], extrusionFeatureTypeV6.type],
        ["face_extent_extrude", faceExtrude, [id(1)], extrusionFeatureTypeV7.type],
        ["hole", hole, [id(1)], holeFeatureTypeV3.type],
        ["thread", thread, [id(1), id(2)], threadFeatureTypeV2.type],
      ] as const) {
        const operation = localOperationSchema.parse({
          tool: `${action}_${suffix}`,
          arguments: { ...base, dependencies, parameters },
        })
        const request = advancedCommand(operation)
        const parsed = parseDocumentCommand(request.command)
        expect(parsed.ok).toBe(true)
        expect(request).toMatchObject({
          draftId: base.draftId,
          command: {
            commandId: base.commandId,
            baseRevision: 7,
            documentId: id(60),
            actor,
            kind:
              action === "create" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
            payload: { feature: { id: base.featureId, type, dependencies, references: [] } },
          },
        })
        const feature = request.command.payload
        expect(feature).toMatchObject({
          feature: {
            parameters: suffix === "hole" ? { ...hole, pointIds: [id(3), id(4)] } : parameters,
          },
        })
      }
    },
  )

  it("rejects missing, reversed and self-bound dependencies without changing legacy scopes", () => {
    for (const [suffix, parameters, dependencies] of [
      ["extrude", extrude, [id(1)]],
      ["face_extent_extrude", faceExtrude, [id(1)]],
      ["hole", hole, [id(1)]],
      ["thread", thread, [id(1), id(2)]],
    ] as const) {
      for (const action of ["create", "update"])
        for (const invalid of [
          [],
          [id(9)],
          [...dependencies].reverse().concat(id(9)),
          [base.featureId],
        ])
          expect(
            localOperationSchema.safeParse({
              tool: `${action}_${suffix}`,
              arguments: { ...base, dependencies: invalid, parameters },
            }).success,
          ).toBe(false)
    }
  })

  it("rejects actor and document authority injected into the v7 named operation", () => {
    for (const injected of [{ actor }, { documentId: id(60) }, { schemaVersion: 6 }]) {
      expect(
        localOperationSchema.safeParse({
          tool: "create_face_extent_extrude",
          arguments: { ...base, parameters: faceExtrude, ...injected },
        }).success,
      ).toBe(false)
    }
  })

  it("fails closed for invalid recesses, dynamic extents and thread resource budgets", () => {
    const rejected = (tool: string, parameters: unknown, dependencies = base.dependencies) =>
      expect(
        localOperationSchema.safeParse({ tool, arguments: { ...base, dependencies, parameters } })
          .success,
      ).toBe(false)
    rejected("create_hole", {
      ...hole,
      treatment: { ...hole.treatment, diameter: createLengthQuantity(1) },
    })
    rejected("update_hole", {
      ...hole,
      treatment: {
        kind: "countersink",
        diameter: createLengthQuantity(30),
        angle: createAngleQuantity(90, "deg"),
      },
    })
    rejected("create_extrude", { ...extrude, symmetric: true })
    rejected("create_extrude", faceExtrude)
    rejected("update_extrude", faceExtrude)
    rejected("create_face_extent_extrude", extrude)
    rejected("update_face_extent_extrude", { ...faceExtrude, symmetric: true })
    rejected("create_face_extent_extrude", {
      ...faceExtrude,
      endCondition: {
        ...faceExtrude.endCondition,
        face: { ...faceExtrude.endCondition.face, outputRole: "split.positive" },
      },
    })
    rejected("update_extrude", {
      ...extrude,
      endCondition: { ...extrude.endCondition, sourceContentHash: "stale" },
    })
    rejected("create_thread", { ...thread, length: createLengthQuantity(42) }, [id(1), id(2)])
    rejected("update_thread", { ...thread, starts: createScalarQuantity(2) }, [id(1), id(2)])
    rejected("create_thread", {
      ...thread,
      axis: { kind: "explicit-axis", origin: [0, 0, 0], direction: [0, 0, 2] },
    })
  })
})
