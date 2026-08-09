import { describe, expect, it } from "vitest"
import {
  SLICER_BRIDGE_PROTOCOL_VERSION,
  slicerBridgeOriginSchema,
  slicerBridgeTokenSchema,
  slicerHandoffFilenameSchema,
  slicerHandoffResponseSchema,
} from "./protocol"

describe("slicer handoff protocol", () => {
  it("accepts exact origins, portable filenames, tokens, and success responses", () => {
    expect(slicerBridgeOriginSchema.parse("https://cad.example.test")).toBe(
      "https://cad.example.test",
    )
    expect(slicerBridgeTokenSchema.parse("a".repeat(43))).toHaveLength(43)
    expect(slicerHandoffFilenameSchema.parse("Printer bracket.3mf")).toBe("Printer bracket.3mf")
    expect(
      slicerHandoffResponseSchema.parse({
        protocolVersion: SLICER_BRIDGE_PROTOCOL_VERSION,
        ok: true,
        requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f4101",
        slicerId: "orca-slicer",
        filename: "Printer bracket.3mf",
      }),
    ).toMatchObject({ ok: true, slicerId: "orca-slicer" })
  })

  it("rejects origins with paths, unsafe filenames, weak tokens, and unknown diagnostics", () => {
    expect(slicerBridgeOriginSchema.safeParse("https://cad.example.test/editor").success).toBe(
      false,
    )
    expect(slicerHandoffFilenameSchema.safeParse("../project.3mf").success).toBe(false)
    expect(slicerHandoffFilenameSchema.safeParse("project\u0000.3mf").success).toBe(false)
    expect(slicerHandoffFilenameSchema.safeParse("project.stl").success).toBe(false)
    expect(slicerBridgeTokenSchema.safeParse("short").success).toBe(false)
    expect(
      slicerHandoffResponseSchema.safeParse({
        protocolVersion: SLICER_BRIDGE_PROTOCOL_VERSION,
        ok: false,
        diagnostic: { code: "shell-failed", message: "No.", retryable: false },
      }).success,
    ).toBe(false)
  })
})
