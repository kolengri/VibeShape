import { createLengthQuantity } from "@vibeshape/domain/units"
import { describe, expect, it } from "vitest"
import {
  lifecycleId as id,
  primitiveNames,
  primitiveParameters,
} from "../../../tests/support/primitive-lifecycle"
import { localOperationSchema, localToolNameSchema } from "./local-tools"

const base = { draftId: id(1), baseRevision: 0, commandId: id(2) }
const feature = { ...base, featureId: id(3), suppressed: false }
describe("primitive and lifecycle public schemas", () => {
  it.each(primitiveNames)("keeps %s quantity inputs bounded and actor-independent", (name) => {
    const tool = `update_${name}`
    const args = { ...feature, parameters: primitiveParameters(name) }
    expect(localOperationSchema.safeParse({ tool, arguments: args }).success).toBe(true)
    for (const extra of [
      { actor: {} },
      { documentId: id(4) },
      { dependencies: [id(4)] },
      { references: [] },
      { schemaVersion: 99 },
    ])
      expect(
        localOperationSchema.safeParse({ tool, arguments: { ...args, ...extra } }).success,
      ).toBe(false)
    expect(
      localOperationSchema.safeParse({ tool, arguments: { ...args, suppressed: undefined } })
        .success,
    ).toBe(false)
    expect(
      localOperationSchema.safeParse({
        tool,
        arguments: {
          ...args,
          parameters: {
            ...args.parameters,
            ...(name === "box"
              ? { width: createLengthQuantity(-1) }
              : name === "torus"
                ? { minorRadius: createLengthQuantity(-1) }
                : { radius: createLengthQuantity(-1) }),
          },
        },
      }).success,
    ).toBe(false)
  })
  it("rejects invalid registered primitive geometry and unsupported aliases", () => {
    const invalid = [
      [
        "torus",
        { ...primitiveParameters("torus"), majorRadius: primitiveParameters("torus").minorRadius },
      ],
      ["pyramid", { ...primitiveParameters("pyramid"), sides: 65 }],
      [
        "cone",
        {
          ...primitiveParameters("cone"),
          origin: { ...primitiveParameters("cone").origin, x: createLengthQuantity(100001) },
        },
      ],
    ] as const
    for (const [name, parameters] of invalid)
      expect(
        localOperationSchema.safeParse({
          tool: `create_${name}`,
          arguments: { ...feature, parameters },
        }).success,
      ).toBe(false)
    for (const tool of ["create_wedge", "update_wedge", "delete_project", "set_history_cursor"])
      expect(localOperationSchema.safeParse({ tool, arguments: feature }).success).toBe(false)
  })
  it("requires explicit lifecycle assignments and rejects cascade or caller credentials", () => {
    for (const tool of [
      "remove_feature",
      "remove_sketch",
      "set_feature_suppressed",
      "rename_project",
    ] as const) {
      expect(localToolNameSchema.safeParse(tool).success).toBe(true)
      const input =
        tool === "remove_sketch"
          ? { sketchId: id(3) }
          : tool === "rename_project"
            ? { name: "Part" }
            : {
                featureId: id(3),
                ...(tool === "set_feature_suppressed" ? { suppressed: false } : {}),
              }
      expect(
        localOperationSchema.safeParse({ tool, arguments: { ...base, ...input } }).success,
      ).toBe(true)
      for (const extra of [
        { cascade: true },
        { preserveIntent: true },
        { actor: {} },
        { documentId: id(4) },
      ])
        expect(
          localOperationSchema.safeParse({ tool, arguments: { ...base, ...input, ...extra } })
            .success,
        ).toBe(false)
    }
    for (const suppressed of [undefined, "false", 0])
      expect(
        localOperationSchema.safeParse({
          tool: "set_feature_suppressed",
          arguments: { ...base, featureId: id(3), suppressed },
        }).success,
      ).toBe(false)
    for (const name of ["", "  ", " Name", "Name ", "x".repeat(121)])
      expect(
        localOperationSchema.safeParse({ tool: "rename_project", arguments: { ...base, name } })
          .success,
      ).toBe(false)
  })
})
