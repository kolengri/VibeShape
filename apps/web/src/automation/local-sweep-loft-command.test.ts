import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema } from "@vibeshape/domain"
import { loftFeatureType, loftFeatureTypeV2 } from "@vibeshape/domain/part-design-loft"
import { loftFeatureTypeV3 } from "@vibeshape/domain/part-design-loft-v3"
import { sweepFeatureType } from "@vibeshape/domain/part-design-sweep"
import { describe, expect, it } from "vitest"
import { createLoftV3Project } from "../../../../tests/support/loft-v3-fixture"
import { createLocalCadCommand } from "./local-cad-command"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const profile = (n: number) => ({
  schemaVersion: 0,
  sketchId: id(n),
  outerBoundaryEntityIds: [id(n + 10)],
  holeBoundaryEntityIds: [],
})
const loft = { sections: [profile(2), profile(1)], ruled: true }
const sweep = {
  profile: profile(1),
  path: { schemaVersion: 0, sketchId: id(3), entityIds: [id(21), id(22)], startPointId: id(30) },
}
const base = {
  draftId: id(40),
  commandId: id(41),
  baseRevision: 7,
  featureId: id(42),
  label: "Path-authored housing",
  dependencies: [],
  references: [],
  suppressed: false,
}
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(50),
})
describe("ordinary Sweep and Loft draft tools", () => {
  it.each(["create_loft", "update_loft"] as const)(
    "preserves v2 hole tracks and v3 exact curve constraints through %s",
    (tool) => {
      const fixture = createLoftV3Project()
      const hollowSections = fixture.sections.map((section, index) => ({
        ...section,
        holeBoundaryEntityIds: [[id(index + 500)]],
      }))
      const variants = [
        {
          type: loftFeatureTypeV2.type,
          parameters: {
            sections: hollowSections,
            ruled: false,
            holeCorrespondence: [
              {
                sectionBoundaryEntityIds: hollowSections.map(
                  ({ holeBoundaryEntityIds }) => holeBoundaryEntityIds[0],
                ),
              },
            ],
          },
        },
        {
          type: loftFeatureTypeV3.type,
          parameters: {
            sections: fixture.sections,
            ruled: false,
            outerCorrespondence: fixture.outerCorrespondence,
            rails: [{ vertexTrack: 0, path: fixture.railPath }],
            guides: [
              { name: "Wall guide", segmentTrack: 0, continuity: "C0", path: fixture.guidePath },
            ],
            start: [],
            end: [],
          },
        },
      ]
      for (const { type, parameters } of variants) {
        const operation = localOperationSchema.parse({ tool, arguments: { ...base, parameters } })
        if (operation.tool !== "create_loft" && operation.tool !== "update_loft")
          throw new Error("Expected Loft adapter")
        expect(createLocalCadCommand(operation, actor, id(60))).toMatchObject({
          command: { payload: { feature: { type, parameters } } },
        })
        expect(
          localOperationSchema.safeParse({
            tool,
            arguments: { ...base, parameters: { ...parameters, guideSmoothing: "ignored" } },
          }).success,
        ).toBe(false)
      }
    },
  )
  it.each([19, 24])(
    "preserves %i Loft sections and producer dependencies through draft dispatch",
    (count) => {
      const sections = Array.from({ length: count }, (_, index) => profile(index + 100))
      const dependencies = Array.from({ length: count }, (_, index) => id(index + 200))
      for (const tool of ["create_loft", "update_loft"] as const) {
        const operation = localOperationSchema.parse({
          tool,
          arguments: { ...base, dependencies, parameters: { sections, ruled: false } },
        })
        if (operation.tool !== "create_loft" && operation.tool !== "update_loft")
          throw new Error("Expected Loft.")
        expect(createLocalCadCommand(operation, actor, id(60))).toMatchObject({
          command: {
            payload: {
              feature: {
                type: loftFeatureType.type,
                dependencies,
                parameters: { sections, ruled: false },
              },
            },
          },
        })
      }
      expect(
        localOperationSchema.safeParse({
          tool: "create_loft",
          arguments: {
            ...base,
            dependencies: [
              ...dependencies,
              ...Array.from({ length: 25 - count }, (_, index) => id(index + 300)),
            ],
            parameters: { sections, ruled: false },
          },
        }).success,
      ).toBe(false)
    },
  )
  it("keeps Sweep dependency bounds unchanged", () => {
    expect(
      localOperationSchema.safeParse({
        tool: "create_sweep",
        arguments: {
          ...base,
          dependencies: Array.from({ length: 9 }, (_, index) => id(index + 200)),
          parameters: sweep,
        },
      }).success,
    ).toBe(false)
  })
  it.each(["create_loft", "update_loft", "create_sweep", "update_sweep"] as const)(
    "routes %s through one validated ordinary command",
    (tool) => {
      const parameters = tool.endsWith("loft") ? loft : sweep
      const operation = localOperationSchema.parse({ tool, arguments: { ...base, parameters } })
      expect(isLocalDraftCommand(operation)).toBe(true)
      if (
        operation.tool !== "create_loft" &&
        operation.tool !== "update_loft" &&
        operation.tool !== "create_sweep" &&
        operation.tool !== "update_sweep"
      )
        throw new Error("Expected typed multi-sketch tool.")
      expect(createLocalCadCommand(operation, actor, id(60))).toMatchObject({
        draftId: base.draftId,
        command: {
          baseRevision: 7,
          commandId: base.commandId,
          actor,
          kind: tool.startsWith("create_")
            ? "org.vibeshape.feature.add"
            : "org.vibeshape.feature.update",
          payload: {
            feature: {
              id: base.featureId,
              type: tool.endsWith("loft") ? loftFeatureType.type : sweepFeatureType.type,
              parameters,
              dependencies: [],
              references: [],
            },
          },
        },
      })
    },
  )
  it.each([
    {
      tool: "create_loft",
      parameters: {
        ...loft,
        sections: Array.from({ length: 25 }, (_, index) => profile(index + 100)),
      },
    },
    { tool: "create_loft", parameters: { ...loft, sections: [profile(1)] } },
    { tool: "create_loft", parameters: { ...loft, sections: [profile(1), profile(1)] } },
    {
      tool: "create_loft",
      parameters: {
        ...loft,
        sections: [{ ...profile(1), holeBoundaryEntityIds: [[id(99)]] }, profile(2)],
      },
    },
    {
      tool: "create_sweep",
      parameters: { ...sweep, path: { ...sweep.path, entityIds: [id(22), id(21)] } },
    },
    {
      tool: "create_sweep",
      parameters: { ...sweep, path: { ...sweep.path, startPointId: undefined } },
    },
    { tool: "create_sweep", parameters: { ...sweep, profileIndex: 0 } },
  ])("rejects unsupported or ambiguous selectors before dispatch %j", ({ tool, parameters }) => {
    expect(
      localOperationSchema.safeParse({ tool, arguments: { ...base, parameters } }).success,
    ).toBe(false)
  })
})
