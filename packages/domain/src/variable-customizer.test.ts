import { describe, expect, it } from "bun:test"
import { applyDocumentCommand, reduceDocumentEvent, replayDocumentEvents } from "./commands"
import { variableIdSchema } from "./identifiers"
import {
  applyCustomizerConfiguration,
  customizerExpression,
  removeCustomizerConfiguration,
  saveCustomizerConfiguration,
  setCustomizerValue,
} from "./variable-customizer"
import { evaluateVariableDefinitions, variableDefinitionsSchema } from "./variables"

const id = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2601")
const variables = () =>
  variableDefinitionsSchema.parse([
    {
      schemaVersion: 0,
      id,
      name: "width",
      expression: "20 mm",
      customizer: {
        dimension: "length",
        group: "Size",
        min: 10,
        max: 100,
        step: 1,
        configurations: {},
      },
    },
    {
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f2602",
      name: "half",
      expression: "#width / 2",
    },
  ])

describe("variable customizer", () => {
  it("updates an exposed input while retaining downstream expressions and canonical units", () => {
    const next = setCustomizerValue(variables(), id, 40)
    expect(next[0]?.expression).toBe("40 mm")
    expect(next[1]?.expression).toBe("#width / 2")
    const result = evaluateVariableDefinitions(next)
    expect(result.ok && result.valuesByName.get("half")?.value.value).toBe(20)
    expect(customizerExpression({ dimension: "angle", value: Math.PI })).toEndWith(" rad")
    expect(customizerExpression({ dimension: "scalar", value: 5 })).toBe("5")
  })
  it("saves and applies configurations together, and refuses incomplete/out-of-range values", () => {
    const small = saveCustomizerConfiguration(variables(), "Small")
    const large = saveCustomizerConfiguration(setCustomizerValue(small, id, 80), "Large")
    expect(applyCustomizerConfiguration(large, "Small")[0]?.expression).toBe("20 mm")
    expect(applyCustomizerConfiguration(large, "Large")[0]?.expression).toBe("80 mm")
    expect(removeCustomizerConfiguration(large, "Small")[0]?.customizer?.configurations).toEqual({
      Large: 80,
    })
    expect(() => applyCustomizerConfiguration(large, "Missing")).toThrow("does not cover")
    expect(() => setCustomizerValue(large, id, 101)).toThrow("outside")
    expect(() => setCustomizerValue(large, id, Number.NaN)).toThrow("outside")
    expect(() => saveCustomizerConfiguration(large, " ")).toThrow("configuration name")
    expect(
      variableDefinitionsSchema.safeParse([
        { ...large[0], customizer: { min: 10, max: 1, step: 0 } },
      ]).success,
    ).toBe(false)
  })
  it("rejects dimensions changing underneath saved configurations", () => {
    expect(
      variableDefinitionsSchema.safeParse(
        variables().map((variable) =>
          variable.id === id
            ? { ...variable, expression: "20 deg" }
            : { ...variable, expression: "1" },
        ),
      ).success,
    ).toBe(false)
  })

  it("records metadata-only changes, replays them, and rejects a forged previous table", () => {
    const envelope = {
      schemaVersion: 1,
      documentId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
      issuedAt: "2026-11-01T20:00:00Z",
      actor: { type: "user", userId: null },
    }
    const created = applyDocumentCommand(null, {
      ...envelope,
      kind: "org.vibeshape.document.create",
      commandId: "0195b5ac-b230-7a2c-8c33-67a36a7f21ac",
      baseRevision: 0,
      payload: { name: "Template" },
    })
    if (!created.ok) throw new Error(created.diagnostic.message)
    const added = applyDocumentCommand(created.snapshot, {
      ...envelope,
      kind: "org.vibeshape.variable.replace-table",
      commandId: "0195b5ac-b231-7a2c-8c33-67a36a7f21ac",
      baseRevision: 1,
      payload: { variables: variables() },
    })
    if (!added.ok) throw new Error(added.diagnostic.message)
    const saved = applyDocumentCommand(added.snapshot, {
      ...envelope,
      kind: "org.vibeshape.variable.replace-table",
      commandId: "0195b5ac-b232-7a2c-8c33-67a36a7f21ac",
      baseRevision: 2,
      payload: { variables: saveCustomizerConfiguration(added.snapshot.variables, "Small") },
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error(saved.diagnostic.message)

    if (saved.event.type !== "org.vibeshape.variable.table-replaced")
      throw new Error("Expected a table event.")
    expect(
      reduceDocumentEvent(added.snapshot, {
        ...saved.event,
        previousVariables: saveCustomizerConfiguration(added.snapshot.variables, "Forged"),
      }).ok,
    ).toBe(false)
    expect(replayDocumentEvents([created.event, added.event, saved.event])).toEqual({
      ok: true,
      snapshot: saved.snapshot,
    })
  })
})
