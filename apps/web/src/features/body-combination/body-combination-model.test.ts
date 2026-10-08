import { describe, expect, it } from "bun:test"
import type { ResolvedAuthoredPart } from "@vibeshape/application/authored-parts"
import {
  createAngleQuantity,
  createLengthQuantity,
  featureIdSchema,
  featureRecordSchema,
  featureRecordV1Schema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { createDocumentDependencyGraph } from "@vibeshape/domain/document-graph"
import type { DocumentSnapshotV2 } from "@vibeshape/domain/document-v2"
import { applyDocumentV2Command } from "@vibeshape/domain/document-v2-commands"
import { compoundSlotIdSchema } from "@vibeshape/domain/identifiers"
import { compoundBodyOutputRole } from "@vibeshape/domain/part-design-body-combination"
import { placementFeatureType } from "@vibeshape/domain/part-design-placement"
import {
  authoredTestBody,
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../../test-support/authored-tree-fixture"
import { authoredPlacementTarget } from "../part-design/authored-part-selection"
import {
  type BodyCombinationInput,
  type BodyCombinationKind,
  type BodyCombinationMode,
  bodyCombinationFeature,
  combinationInputOptions,
  moveCombinationInput,
  retainedCombinationInputs,
  selectedCombinationInputs,
} from "./body-combination-model"

function fixture(operation: BodyCombinationKind = "compound") {
  const { authority } = authoredTreeFixture()
  const parts: ResolvedAuthoredPart[] = authority.parts.map((part) => ({
    part,
    body: authoredTestBody(part),
    status: "available",
  }))
  const inputs: BodyCombinationInput[] = authority.parts.map((part) => ({
    partId: part.id,
    name: part.name,
    body: requireAuthoredFixture(part.bodyHistory[0]),
  }))
  const featureId = featureIdSchema.parse(authoredTestId(500))
  const mode: BodyCombinationMode = {
    kind: "create",
    operation,
    initial: [],
    createFeatureId: () => featureId,
    featureLabel: "Combination",
  }
  const slots = new Map(
    inputs.map((input, index) => [
      input.partId,
      compoundSlotIdSchema.parse(authoredTestId(600 + index)),
    ]),
  )
  return { authority, parts, inputs, featureId, mode, slots }
}
function committedFixture(operation: BodyCombinationKind) {
  const data = fixture(operation)
  const inputs = data.inputs.slice(0, 2)
  const feature = bodyCombinationFeature(data.mode, data.featureId, inputs, data.slots)
  const envelope = {
    commandId: authoredTestId(700),
    documentId: data.authority.id,
    baseRevision: data.authority.revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
  const result = applyDocumentV2Command(data.authority, {
    ...envelope,
    schemaVersion: 2,
    kind: "org.vibeshape.document.model-command",
    payload: {
      command: {
        ...envelope,
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-feature",
        payload: { historyAfter: data.authority.history.at(-1), feature },
      },
      partAllocations: [],
    },
  })
  if (!result.ok) throw new Error(JSON.stringify(result))
  return { ...data, feature, authority: result.snapshot }
}

function applyModelFeature(
  authority: DocumentSnapshotV2,
  feature: ReturnType<typeof featureRecordSchema.parse>,
  editing = false,
) {
  const envelope = {
    commandId: authoredTestId(1000 + authority.revision),
    documentId: authority.id,
    baseRevision: authority.revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
  const command = editing
    ? { ...envelope, schemaVersion: 1, kind: "org.vibeshape.feature.update", payload: { feature } }
    : {
        ...envelope,
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-feature",
        payload: { historyAfter: authority.history.at(-1), feature },
      }
  const result = applyDocumentV2Command(authority, {
    ...envelope,
    schemaVersion: 2,
    kind: "org.vibeshape.document.model-command",
    payload: { command, partAllocations: [] },
  })
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result.snapshot
}
function suppressFeature(authority: DocumentSnapshotV2, id: string) {
  const source = requireAuthoredFixture(authority.features.find((feature) => feature.id === id))
  return applyModelFeature(
    authority,
    featureRecordSchema.parse({
      schemaVersion: 0,
      id: source.id,
      type: source.type,
      parameters: source.parameters,
      dependencies: source.dependencies,
      references: source.references,
      suppressed: true,
      label: source.label,
    }),
    true,
  )
}

describe("authored combination inputs", () => {
  it("admits only visible current tips for new operations", () => {
    const data = fixture()
    expect(combinationInputOptions(data.authority, data.parts, data.mode)).toEqual(data.inputs)
    const part = requireAuthoredFixture(data.parts[0])
    for (const status of ["upstream", "consumed", "unavailable"] as const)
      expect(authoredPlacementTarget({ ...part, status })).toBeNull()
    expect(authoredPlacementTarget({ ...part, part: { ...part.part, visible: false } })).toBeNull()
    expect(authoredPlacementTarget({ ...part, body: null })).toBeNull()
    expect(authoredPlacementTarget(undefined)).toBeNull()
  })
  it("accepts distinct sibling output roles and rejects duplicate bodies or incomplete selections", () => {
    const { inputs } = fixture()
    const first = requireAuthoredFixture(inputs[0])
    const second = requireAuthoredFixture(inputs[1])
    const sibling = { ...second, body: { ...first.body, outputRole: "body.second" } }
    expect(selectedCombinationInputs([first.partId, second.partId], [first, sibling])).toEqual([
      first,
      sibling,
    ])
    expect(
      selectedCombinationInputs(
        [first.partId, second.partId],
        [first, { ...second, body: first.body }],
      ),
    ).toBeNull()
    expect(selectedCombinationInputs([first.partId, first.partId], inputs)).toBeNull()
    expect(selectedCombinationInputs([first.partId], inputs)).toBeNull()
    expect(selectedCombinationInputs([first.partId, second.partId], [first])).toBeNull()
  })
  it("retains Compound slot identity when editing and reordering current named outputs", () => {
    const { authority, feature, slots } = committedFixture("compound")
    const initial = retainedCombinationInputs(authority, feature, "compound")
    if (!initial) throw new Error("Compound inputs must resolve.")
    expect(initial.map(({ slotId }) => slotId)).toEqual([...slots.values()].slice(0, 2))
    const selected = moveCombinationInput(
      initial.map(({ partId }) => partId),
      0,
      1,
    )
    const reordered = selectedCombinationInputs(selected, initial)
    if (!reordered) throw new Error("Reordered inputs must remain valid.")
    const updated = bodyCombinationFeature(
      { kind: "edit", operation: "compound", feature, initial },
      feature.id,
      reordered,
      slots,
    )
    expect(updated.id).toBe(feature.id)
    expect(updated.label).toBe(feature.label)
    expect(updated.dependencies).toEqual([...feature.dependencies].reverse())
    expect(updated.parameters.slots).toEqual<unknown>(
      [...(feature.parameters.slots as unknown[])].reverse(),
    )
    for (const input of initial)
      expect(
        authority.parts.find(({ id }) => id === input.partId)?.bodyHistory.at(-1)?.outputRole,
      ).toBe(compoundBodyOutputRole(requireAuthoredFixture(input.slotId)))
  })
  it("retains consumed Union inputs and the named survivor without selecting its result as a new input", () => {
    const { authority, feature, inputs } = committedFixture("union")
    const initial = retainedCombinationInputs(authority, feature, "union")
    expect(initial).toEqual(inputs.slice(0, 2))
    if (!initial) throw new Error("Union inputs must resolve.")
    const parts: ResolvedAuthoredPart[] = authority.parts.map((part) => ({
      part,
      body: part.consumedBy ? null : authoredTestBody(part),
      status: part.consumedBy ? "consumed" : "available",
    }))
    const options = combinationInputOptions(authority, parts, {
      kind: "edit",
      operation: "union",
      feature,
      initial,
    })
    expect(options).toHaveLength(3)
    expect(options.map(({ body }) => body.featureId)).not.toContain(feature.id)
    expect(authority.parts[0]?.id).toBe(inputs[0]?.partId)
    expect(authority.parts[1]?.consumedBy).toBe(feature.id)
  })
  it("fails closed when persisted input ownership is missing", () => {
    const { authority, feature } = committedFixture("compound")
    expect(retainedCombinationInputs({ ...authority, parts: [] }, feature, "compound")).toBeNull()
  })
  it("excludes transitive dependents across face-supported sketches from new edit inputs", () => {
    const data = committedFixture("union")
    const initial = retainedCombinationInputs(data.authority, data.feature, "union")
    if (!initial) throw new Error("Union inputs must resolve.")
    const third = requireAuthoredFixture(data.authority.features[2])
    const sketch = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: authoredTestId(800),
      label: "Supported sketch",
      plane: "xy",
      entities: [],
      constraints: [],
      support: {
        kind: "feature-face",
        reference: {
          schemaVersion: 0,
          featureId: data.feature.id,
          kind: "face",
          signature: {
            kind: "face",
            geometryClass: "PLANE",
            measure: 1,
            centroid: [0, 0, 0],
            bounds: { min: [0, 0, 0], max: [1, 1, 0] },
            boundaryCount: 4,
            adjacentGeometryClasses: [],
          },
        },
      },
    })
    const downstream = featureRecordV1Schema.parse({
      schemaVersion: 1,
      id: third.id,
      type: {
        moduleId: "org.vibeshape.core.part-design",
        moduleVersion: "0.1.0",
        typeId: "org.vibeshape.feature.part-design.extrusion",
        schemaVersion: 2,
      },
      parameters: {
        profile: {
          schemaVersion: 0,
          sketchId: sketch.id,
          outerBoundaryEntityIds: [authoredTestId(801)],
          holeBoundaryEntityIds: [],
        },
        distance: createLengthQuantity(10),
        symmetric: false,
        operation: "new",
      },
      dependencies: [],
      references: [],
      semanticInputs: [{ kind: "sketch", id: sketch.id }],
      suppressed: false,
    })
    const authority = {
      ...data.authority,
      sketches: [sketch],
      features: [...data.authority.features.filter(({ id }) => id !== third.id), downstream],
      history: [
        ...data.authority.history.filter(({ id }) => id !== third.id),
        { kind: "sketch" as const, id: sketch.id },
        { kind: "feature" as const, id: third.id },
      ],
    }
    const graph = createDocumentDependencyGraph(authority)
    if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostic))
    expect(graph.graph.dependencyModelIssues).toEqual([])
    expect(graph.graph.dependentsOf({ kind: "feature", id: data.feature.id })).toContainEqual({
      kind: "sketch",
      id: sketch.id,
    })
    const parts: ResolvedAuthoredPart[] = authority.parts.map((part) => ({
      part,
      body: authoredTestBody(part),
      status: "available",
    }))
    expect(
      combinationInputOptions(authority, parts, {
        kind: "edit",
        operation: "union",
        feature: data.feature,
        initial,
      }),
    ).toEqual(initial)
  })
  it("resolves retained inputs when Union suppression removes every consumption marker", () => {
    const data = committedFixture("union")
    const authority = suppressFeature(data.authority, data.feature.id)
    expect(authority.parts.every(({ consumedBy }) => consumedBy === null)).toBe(true)
    expect(
      retainedCombinationInputs(authority, { ...data.feature, suppressed: true }, "union"),
    ).toEqual(data.inputs.slice(0, 2))
  })
  it("repairs an unsuppressed Union after source suppression using a different current part", () => {
    const data = committedFixture("union")
    const failed = requireAuthoredFixture(data.inputs[1])
    const authority = suppressFeature(data.authority, failed.body.featureId)
    expect(authority.features.find(({ id }) => id === data.feature.id)?.suppressed).toBe(false)
    expect(authority.parts.every(({ consumedBy }) => consumedBy === null)).toBe(true)
    const initial = retainedCombinationInputs(authority, data.feature, "union")
    if (!initial) throw new Error("A failed input must remain editable.")
    const mode: BodyCombinationMode = {
      kind: "edit",
      operation: "union",
      feature: data.feature,
      initial,
    }
    const parts: ResolvedAuthoredPart[] = authority.parts.map((part) =>
      part.id === failed.partId
        ? { part, body: null, status: "unavailable" }
        : { part, body: authoredTestBody(part), status: "available" },
    )
    const options = combinationInputOptions(authority, parts, mode)
    const replacement = requireAuthoredFixture(data.inputs[2])
    const selected = selectedCombinationInputs(
      [requireAuthoredFixture(initial[0]).partId, replacement.partId],
      options,
    )
    if (!selected) throw new Error("The replacement must be a valid current input.")
    const feature = bodyCombinationFeature(mode, data.feature.id, selected, data.slots)
    const repaired = applyModelFeature(authority, feature, true)
    expect(repaired.parts.find(({ id }) => id === replacement.partId)?.consumedBy).toBe(
      data.feature.id,
    )
    expect(repaired.parts.find(({ id }) => id === failed.partId)?.consumedBy).toBeNull()
    expect(repaired.features.find(({ id }) => id === data.feature.id)?.dependencies).toEqual(
      selected.map(({ body }) => body.featureId),
    )
  })
  it("retains historical tool inputs whose current part is intentionally not consumed", () => {
    const data = fixture("union")
    const tool = requireAuthoredFixture(data.inputs[1])
    const placement = featureRecordSchema.parse({
      schemaVersion: 0,
      id: authoredTestId(850),
      type: placementFeatureType.type,
      parameters: {
        targetBody: tool.body,
        translation: {
          x: createLengthQuantity(10),
          y: createLengthQuantity(0),
          z: createLengthQuantity(0),
        },
        rotation: {
          x: createAngleQuantity(0),
          y: createAngleQuantity(0),
          z: createAngleQuantity(0),
        },
      },
      dependencies: [tool.body.featureId],
      references: [],
      suppressed: false,
    })
    const placed = applyModelFeature(data.authority, placement)
    const feature = bodyCombinationFeature(
      data.mode,
      data.featureId,
      data.inputs.slice(0, 2),
      data.slots,
    )
    const authority = applyModelFeature(placed, feature)
    expect(authority.parts.find(({ id }) => id === tool.partId)?.consumedBy).toBeNull()
    expect(retainedCombinationInputs(authority, feature, "union")).toEqual(data.inputs.slice(0, 2))
    const ambiguous = {
      ...authority,
      parts: [
        ...authority.parts,
        {
          ...requireAuthoredFixture(authority.parts.find(({ id }) => id === tool.partId)),
          id: requireAuthoredFixture(data.inputs[2]).partId,
        },
      ],
    }
    expect(retainedCombinationInputs(ambiguous, feature, "union")).toBeNull()
  })
})
