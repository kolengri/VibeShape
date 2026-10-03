import { isLocalDraftCommand, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { commandActorSchema, createLengthQuantity, datumPlaneFeatureType } from "@vibeshape/domain"
import { booleanFeatureType } from "@vibeshape/domain/part-design"
import {
  compoundFeatureTypeV2,
  unionFeatureTypeV2,
} from "@vibeshape/domain/part-design-body-combination"
import { describe, expect, it, vi } from "vitest"
import { createLocalToolExecutor } from "./local-tool-executor"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const base = {
  draftId: id(1),
  commandId: id(2),
  baseRevision: 7,
  featureId: id(3),
  label: "Authored housing",
  suppressed: false,
  references: [],
}
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(4),
})
const body = (n: number, outputRole: string) => ({ schemaVersion: 0, featureId: id(n), outputRole })
const bodies = [body(5, "split.positive"), body(6, "result"), body(5, "split.negative")]
const face = {
  schemaVersion: 0,
  featureId: id(5),
  kind: "face",
  semanticRole: "face.top",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 100,
    centroid: [5, 5, 10],
    bounds: { min: [0, 0, 10], max: [10, 10, 10] },
    direction: [0, 0, 1],
    directionMode: "oriented",
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE"],
  },
}
const slots = bodies.map((targetBody, index) => ({ slotId: id(10 + index), targetBody }))
const cases = [
  {
    suffix: "datum_plane",
    type: datumPlaneFeatureType.type,
    arguments: {
      ...base,
      dependencies: [],
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xz" },
        offset: createLengthQuantity(-29.5, "mm", "-29.5 mm"),
      },
    },
  },
  {
    suffix: "datum_plane",
    type: datumPlaneFeatureType.type,
    arguments: {
      ...base,
      dependencies: [id(5)],
      references: [face],
      parameters: {
        mode: "offset",
        support: { kind: "feature-face", reference: face },
        offset: createLengthQuantity(2),
      },
    },
  },
  {
    suffix: "boolean",
    type: booleanFeatureType.type,
    arguments: {
      ...base,
      dependencies: [id(6), id(5)],
      parameters: { operation: "subtract", keepTools: true },
    },
  },
  {
    suffix: "union",
    type: unionFeatureTypeV2.type,
    arguments: { ...base, dependencies: [id(5), id(6)], parameters: { bodies } },
  },
  {
    suffix: "compound",
    type: compoundFeatureTypeV2.type,
    arguments: { ...base, dependencies: [id(5), id(6)], parameters: { slots } },
  },
]

describe("local Datum Plane and body combination draft tools", () => {
  it.each(cases)(
    "dispatches create/update $suffix through the owner-bound ordinary host",
    async ({ suffix, type, arguments: arguments_ }) => {
      for (const action of ["create", "update"]) {
        const host = {
          createDraft: vi.fn(),
          inspectDraft: vi.fn(),
          applyCommand: vi.fn().mockResolvedValue({
            ok: false,
            diagnostic: { code: "stale-revision", message: "Draft changed.", retryable: true },
          }),
          previewDraft: vi.fn(),
          commitDraft: vi.fn(),
          discardDraft: vi.fn(),
        }
        const executor = createLocalToolExecutor(
          {
            documentId: id(20),
            revision: 0,
            host,
            readCad: vi.fn(),
            readInfo: () => null,
            exportRevisionBound: vi.fn(),
          },
          actor,
        )
        const operation = localOperationSchema.parse({
          tool: `${action}_${suffix}`,
          arguments: arguments_,
        })
        expect(isLocalDraftCommand(operation)).toBe(true)
        await expect(executor.execute(operation)).resolves.toEqual({
          ok: false,
          diagnostic: { code: "stale-revision", message: "Draft changed.", retryable: true },
        })
        expect(host.applyCommand).toHaveBeenCalledExactlyOnceWith(actor, {
          schemaVersion: 1,
          draftId: base.draftId,
          command: {
            schemaVersion: 1,
            commandId: base.commandId,
            documentId: id(20),
            baseRevision: 7,
            issuedAt: expect.any(String),
            actor,
            kind:
              action === "create" ? "org.vibeshape.feature.add" : "org.vibeshape.feature.update",
            payload: {
              feature: {
                schemaVersion: 0,
                id: base.featureId,
                type,
                parameters: arguments_.parameters,
                dependencies: arguments_.dependencies,
                references: arguments_.references,
                label: base.label,
                suppressed: false,
              },
            },
          },
        })
        expect(host.commitDraft).not.toHaveBeenCalled()
        expect(host.previewDraft).not.toHaveBeenCalled()
      }
    },
  )

  it.each([
    { dependencies: [id(5)] },
    { references: [face] },
    { parameters: { mode: "three-point", support: { kind: "origin-plane", plane: "xy" } } },
    {
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "custom" },
        offset: createLengthQuantity(0),
      },
    },
    {
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(1_000_001),
      },
    },
  ])("rejects invalid origin plane intent before dispatch %j", (changes) => {
    expect(
      localOperationSchema.safeParse({
        tool: "create_datum_plane",
        arguments: { ...cases[0]?.arguments, ...changes },
      }).success,
    ).toBe(false)
  })

  it.each([
    { dependencies: [] },
    { dependencies: [id(6)] },
    { dependencies: [id(3)] },
    { references: [] },
    { references: [{ ...face, semanticRole: "face.bottom" }] },
    { references: [{ ...face, schemaVersion: 1, outputRole: "result" }] },
  ])("rejects mismatched or unsupported face support before dispatch %j", (changes) => {
    expect(
      localOperationSchema.safeParse({
        tool: "update_datum_plane",
        arguments: { ...cases[1]?.arguments, ...changes },
      }).success,
    ).toBe(false)
  })

  it.each([
    { dependencies: [] },
    { dependencies: [id(5), id(5)] },
    { dependencies: [id(3), id(5)] },
    { dependencies: [id(5), id(6), id(7)] },
    { references: [face] },
    { parameters: { operation: "union" } },
    { parameters: { operation: "subtract", targetBody: body(5, "result") } },
  ])("rejects unsupported Boolean intent before dispatch %j", (changes) => {
    expect(
      localOperationSchema.safeParse({
        tool: "create_boolean",
        arguments: { ...cases[2]?.arguments, ...changes },
      }).success,
    ).toBe(false)
  })

  it.each(["union", "compound"])("rejects incomplete %s selections and identities", (suffix) => {
    const arguments_ = cases.find((entry) => entry.suffix === suffix)?.arguments
    const parameters = (selected: typeof bodies) =>
      suffix === "union"
        ? { bodies: selected }
        : { slots: selected.map((targetBody, index) => ({ slotId: id(10 + index), targetBody })) }
    const changes = [
      { dependencies: [] },
      { dependencies: [id(6), id(5)] },
      { dependencies: [id(5), id(6), id(5)] },
      { dependencies: [id(5), id(6), id(7)] },
      { references: [face] },
      { parameters: parameters([bodies[0] as (typeof bodies)[number]]) },
      { parameters: parameters([body(5, "result"), body(5, "result")]) },
      { parameters: parameters(Array.from({ length: 9 }, (_, index) => body(5, `body.${index}`))) },
      {
        parameters: parameters([body(3, "result"), body(6, "result")]),
        dependencies: [id(3), id(6)],
      },
      { commandId: "legacy-id" },
      { featureId: "0195b5ac-b250-4a2c-8c33-000000000003" },
      { baseRevision: -1 },
    ]
    for (const change of changes)
      expect(
        localOperationSchema.safeParse({
          tool: `create_${suffix}`,
          arguments: { ...arguments_, ...change },
        }).success,
      ).toBe(false)
    if (suffix === "compound")
      expect(
        localOperationSchema.safeParse({
          tool: "update_compound",
          arguments: {
            ...arguments_,
            parameters: { slots: slots.map((slot) => ({ ...slot, slotId: id(10) })) },
          },
        }).success,
      ).toBe(false)
  })
})
