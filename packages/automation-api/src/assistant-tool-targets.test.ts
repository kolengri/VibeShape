import { describe, expect, it } from "bun:test"
import { createLengthQuantity, createScalarQuantity } from "@vibeshape/domain/units"
import { assistantToolTargetsSchema } from "./assistant"
import {
  assistantToolResultFailed,
  assistantToolResultText,
  assistantToolTargets,
} from "./assistant-tool-targets"
import { parseMcpToolCall } from "./local-tools"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const projectId = id(1)
const command = { draftId: id(2), baseRevision: 0, commandId: id(3) }
const feature = {
  ...command,
  featureId: id(4),
  widthMm: 10,
  depthMm: 20,
  heightMm: 30,
}
const targets = assistantToolTargetsSchema.parse({ projectId, featureIds: [id(4)], sketchIds: [] })

describe("assistant display targets", () => {
  it.each(["create_box", "mcp.vs_123.create_box", "mcp__vs_123__create_box"])(
    "validates %s inputs before extracting its authored feature",
    (name) => expect(assistantToolTargets(projectId, name, feature)).toEqual(targets),
  )

  it("takes cylinder, boolean and reference pattern identities from validated inputs", () => {
    const common = { ...command, featureId: id(4), label: "Operation", suppressed: false }
    const calls = [
      {
        name: "create_cylinder",
        args: {
          ...common,
          parameters: {
            radius: createLengthQuantity(2),
            height: createLengthQuantity(3),
            centered: true,
          },
        },
      },
      {
        name: "create_boolean",
        args: {
          ...common,
          dependencies: [id(5), id(6)],
          references: [],
          parameters: { operation: "subtract", keepTools: false },
        },
      },
      {
        name: "create_reference_body_pattern",
        args: {
          ...common,
          dependencies: [id(5), id(6)],
          references: [],
          parameters: {
            targetBody: { schemaVersion: 0, featureId: id(5), outputRole: "result" },
            kind: "linear",
            axis: { kind: "datum-axis", featureId: id(6), axis: "x" },
            count: createScalarQuantity(3),
            spacing: createLengthQuantity(30),
          },
        },
      },
    ]
    for (const { name, args } of calls) {
      expect(parseMcpToolCall(name, args).success).toBe(true)
      expect(assistantToolTargets(projectId, name, args)).toEqual(targets)
    }
  })

  it("preserves the sketch namespace even when UUID text matches a feature", () => {
    const sketch = {
      schemaVersion: 0,
      id: id(4),
      label: "Sketch",
      plane: "xy",
      entities: [],
      constraints: [],
    }
    for (const name of ["create_sketch", "update_sketch"])
      expect(assistantToolTargets(projectId, name, { ...command, sketch })).toEqual(
        assistantToolTargetsSchema.parse({
          projectId,
          featureIds: [],
          sketchIds: [id(4)],
        }),
      )
    expect(
      assistantToolTargets(projectId, "remove_sketch", { ...command, sketchId: id(4) }),
    ).toEqual(
      assistantToolTargetsSchema.parse({
        projectId,
        featureIds: [],
        sketchIds: [id(4)],
      }),
    )
  })

  it("ignores reads, variables, missing names and invalid or foreign scopes", () => {
    const variable = {
      ...command,
      variable: { schemaVersion: 0, id: id(4), name: "width", expression: "10 mm" },
    }
    expect(parseMcpToolCall("create_variable", variable).success).toBe(true)
    expect(assistantToolTargets(projectId, "create_variable", variable)).toBeUndefined()
    for (const [name, args] of [
      [undefined, feature],
      [null, feature],
      ["Create box", feature],
      ["model_info", {}],
      ["model_entity", { featureId: id(4) }],
      ["unsupported", feature],
      ["create_box", { ...feature, featureId: "invalid" }],
      ["create_box", { ...feature, widthMm: -1 }],
      ["create_box", { ...feature, unexpected: id(4) }],
      ["create_box", { ...feature, projectId: id(8) }],
    ] as const)
      expect(assistantToolTargets(projectId, name, args)).toBeUndefined()
    expect(assistantToolTargets("invalid", "create_box", feature)).toBeUndefined()
    expect(assistantToolTargets(projectId, "create_box", { ...feature, projectId })).toEqual(
      targets,
    )
  })

  it("bounds and validates the display-only DTO without adding authority", () => {
    expect(assistantToolTargetsSchema.safeParse(targets).success).toBe(true)
    for (const invalid of [
      { ...targets, featureIds: Array(33).fill(id(4)) },
      { ...targets, sketchIds: Array(33).fill(id(4)) },
      { ...targets, projectId: "project" },
      { ...targets, sketchIds: ["invalid"] },
      { ...targets, featureIds: ["a5d39d65-095e-4de7-abf6-0a55e5ed3607"] },
      { ...targets, outputRole: "result" },
      { ...targets, allow: true },
    ])
      expect(assistantToolTargetsSchema.safeParse(invalid).success).toBe(false)
  })

  it("recognizes structured failure diagnostics without interpreting output prose", () => {
    for (const result of [
      { ok: false },
      { isError: true },
      { result: { ok: false } },
      { structuredContent: { result: { ok: false } } },
    ])
      expect(assistantToolResultFailed(result)).toBe(true)
    for (const result of [
      undefined,
      null,
      { ok: true },
      "ok: false",
      { content: [{ text: "failed" }] },
    ])
      expect(assistantToolResultFailed(result)).toBe(false)
  })
})

describe("assistant bounded tool result evidence", () => {
  const failure = {
    ok: false,
    diagnostic: {
      code: "invalid-geometry",
      message: "The preview could not build a closed solid.",
      retryable: true,
    },
  }

  it.each([
    failure,
    { result: failure },
    { structuredContent: failure },
    { structuredContent: { result: failure }, content: [{ type: "text", text: "Other output" }] },
  ])("preserves the validated local diagnostic at known boundaries: %j", (output) => {
    expect(JSON.parse(assistantToolResultText(output) ?? "")).toEqual(failure)
  })

  it("prioritizes a local reason before a large preceding MCP payload", () => {
    const output = {
      isError: true,
      content: [{ type: "text", text: "x".repeat(40_000) }],
      structuredContent: { result: failure },
    }
    expect(assistantToolResultText(output)).toContain("The preview could not build a closed solid.")
    expect(assistantToolResultText(output)?.length).toBeLessThan(1_000)
  })

  it("retains an explicit bounded diagnostic message when ancillary diagnostic fields are omitted", () => {
    const result = {
      ok: false,
      diagnostic: { message: "The preview failed before producing geometry." },
    }
    expect(JSON.parse(assistantToolResultText({ structuredContent: { result } }) ?? "")).toEqual(
      result,
    )
  })

  it("renders MCP text, known error fields, and plain values without guessing failure status", () => {
    expect(
      assistantToolResultText({
        isError: true,
        content: [
          { type: "image", data: "ignored" },
          { type: "text", text: "First reason" },
          { type: "text", text: "Second reason" },
        ],
      }),
    ).toBe("First reason\nSecond reason")
    for (const value of [
      "A plain reason",
      42,
      false,
      { note: "A plain result" },
      ["A", "B"],
      { error: "A provider error" },
      { error: { code: -32603, message: "Cannot preview", privateField: "omitted" } },
      { code: -32603, message: "Cannot preview" },
      new Error("Cannot preview"),
    ]) {
      const text = assistantToolResultText(value)
      expect(text).toBeDefined()
      expect(text).not.toContain("privateField")
      expect(assistantToolResultFailed(value)).toBe(false)
    }
  })

  it("leaves absent diagnostics empty and never invents a failure from prose or nested errors", () => {
    for (const value of [
      undefined,
      null,
      "",
      " \n ",
      {},
      [],
      { ok: false },
      { isError: true },
      { result: { ok: false } },
      { structuredContent: { result: { ok: false } } },
      { isError: true, content: [{ type: "text", text: " " }] },
    ])
      expect(assistantToolResultText(value)).toBeUndefined()
    expect(assistantToolResultFailed({ arbitrary: { error: { ok: false } } })).toBe(false)
  })

  it("bounds every supported display path and tolerates non-serializable plain values", () => {
    for (const value of [
      "x".repeat(40_000),
      new Error("x".repeat(40_000)),
      { error: "x".repeat(40_000) },
      { note: "x".repeat(40_000) },
      { content: Array.from({ length: 100 }, () => ({ type: "text", text: "x".repeat(1000) })) },
    ]) {
      expect(assistantToolResultText(value)?.length).toBe(32_000)
    }
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(assistantToolResultText(cyclic)).toBeUndefined()
  })
})
