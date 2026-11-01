import { describe, expect, it } from "bun:test"
import {
  localOperationSchema,
  localToolInputs,
  localToolOutputs,
  printReadinessResultContextMatches,
} from "./local-tools"

const documentId = "0195b5ac-b281-7a2c-8c33-000000000001"
describe("print readiness transport contract", () => {
  const argumentsValue = { revision: 5, rotationX: 90, rotationY: 0, rotationZ: 0 }
  const operation = () =>
    localOperationSchema.parse({ tool: "analyze_print_readiness", arguments: argumentsValue })
  const value = () => ({
    documentId,
    ...localToolInputs.analyze_print_readiness.parse(argumentsValue),
    status: "unknown",
    bodies: [],
  })
  it("requires explicit print orientation and supplies threshold defaults", () => {
    expect(operation().arguments).toMatchObject({ minimumWallMm: 0.8, overhangAngleDeg: 45 })
    expect(localToolInputs.analyze_print_readiness.safeParse({ revision: 5 }).success).toBe(false)
    expect(
      localToolInputs.analyze_print_readiness.safeParse({ ...argumentsValue, overhangAngleDeg: 91 })
        .success,
    ).toBe(false)
    expect(
      localToolOutputs.analyze_print_readiness.safeParse({ ok: true, value: value() }).success,
    ).toBe(true)
    expect(
      localToolOutputs.analyze_print_readiness.safeParse({
        ok: true,
        value: { ...value(), status: "no-findings" },
      }).success,
    ).toBe(false)
  })
  it("rejects wrong source, orientation, revision or thresholds on both transports", () => {
    expect(
      printReadinessResultContextMatches(operation(), { ok: true, value: value() }, documentId),
    ).toBe(true)
    expect(
      printReadinessResultContextMatches(
        { ...operation(), projectId: documentId },
        { ok: true, value: value() },
        documentId,
      ),
    ).toBe(true)
    expect(
      printReadinessResultContextMatches(
        { ...operation(), projectId: documentId },
        { ok: true, value: { ...value(), rotationX: 0 } },
        documentId,
      ),
    ).toBe(false)
    for (const override of [
      { revision: 6 },
      { rotationX: 0 },
      { minimumWallMm: 1 },
      { documentId: "0195b5ac-b281-7a2c-8c33-000000000002" },
    ])
      expect(
        printReadinessResultContextMatches(
          operation(),
          { ok: true, value: { ...value(), ...override } },
          documentId,
        ),
      ).toBe(false)
    expect(printReadinessResultContextMatches({ tool: "model_info" }, { ok: true })).toBeNull()
  })
})
