import { describe, expect, it } from "bun:test"
import { createLengthQuantity, extrusionFeatureType, sphereFeatureType } from "@vibeshape/domain"
import { documentSnapshotV1Schema } from "@vibeshape/domain/document"
import { documentSnapshotV2Schema } from "@vibeshape/domain/document-v2"
import {
  draftIdSchema,
  featureIdSchema,
  partIdSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import {
  createRectangleSketch,
  rectangleSketchProfileSelector,
} from "@vibeshape/domain/rectangle-sketch"
import { prepareAuthorityTransaction } from "./authority-transaction"
import {
  designRecipeSchema,
  emitDesignRecipeTypeScript,
  exportDesignRecipe,
  prepareDesignRecipeReplay,
  startMacroRecording,
  stopMacroRecording,
} from "./design-recipes"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const timestamp = "2026-10-03T00:00:00.000Z"
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function target() {
  return documentSnapshotV2Schema.parse({
    schemaVersion: 2,
    id: id(1),
    revision: 2,
    name: "Destination",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [{ schemaVersion: 0, id: id(2), name: "width", expression: "50 mm" }],
    sketches: [],
    features: [],
    history: [],
    parts: [],
    folders: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}
function model() {
  let sequence = 100
  const rectangle = createRectangleSketch({
    id: sketchIdSchema.parse(id(10)),
    label: "Profile",
    plane: "xy",
    width: createLengthQuantity(20, "mm", "#width"),
    height: createLengthQuantity(10),
    createEntityId: () => sketchEntityIdSchema.parse(id(sequence++)),
    createConstraintId: () => sketchConstraintIdSchema.parse(id(sequence++)),
  })
  return documentSnapshotV1Schema.parse({
    schemaVersion: 1,
    id: id(8),
    revision: 4,
    name: "Source",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [
      {
        schemaVersion: 0,
        id: id(9),
        name: "width",
        expression: "20 mm",
        customizer: {
          dimension: "length",
          group: "Shape",
          min: 10,
          max: 40,
          step: 1,
          configurations: { Small: 15 },
        },
      },
    ],
    sketches: [rectangle],
    features: [
      {
        schemaVersion: 1,
        id: id(11),
        type: extrusionFeatureType.type,
        parameters: {
          profile: rectangleSketchProfileSelector(rectangle),
          distance: createLengthQuantity(5),
          symmetric: false,
          operation: "new",
        },
        dependencies: [],
        references: [],
        semanticInputs: [{ kind: "sketch", id: rectangle.id }],
        suppressed: false,
        label: "Extrude",
      },
    ],
    history: [
      { kind: "sketch", id: rectangle.id },
      { kind: "feature", id: id(11) },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}
function replay(recipe: unknown, next = 1000) {
  return prepareDesignRecipeReplay(
    recipe,
    target(),
    { transactionId: id(900), issuedAt: timestamp, actor: { type: "user", userId: null } },
    () => id(next++),
  )
}

describe("design recipe interchange and macro replay", () => {
  it("round-trips typed parameters, sketch entity references, History ordering and customizer metadata", () => {
    const source = model()
    const exported = success(exportDesignRecipe(source))
    const original = JSON.stringify(exported.recipe)
    expect(emitDesignRecipeTypeScript(exported.recipe)).toContain("export default recipe")
    const prepared = success(replay(exported.recipe))
    expect(JSON.stringify(exported.recipe)).toBe(original)
    expect(prepared.recipe.variables[0]?.name).toBe("width_recipe1")
    expect(prepared.recipe.variables[0]?.customizer).toEqual(source.variables[0]?.customizer)
    expect(prepared.recipe.sketches[0]?.constraints.at(-2)).toMatchObject({
      value: { source: { expression: "#width_recipe1" } },
    })
    expect(prepared.recipe.features[0]?.parameters.profile).toMatchObject({
      sketchId: prepared.recipe.sketches[0]?.id,
    })
    const sketch = prepared.recipe.sketches[0]
    if (!sketch) throw new Error("Replay must include the source sketch.")
    expect(sketch.id).not.toBe(source.sketches[0]?.id)
    const entityIds = new Set(sketch.entities.map((entity) => entity.id))
    for (const entity of sketch.entities)
      if (entity.type === "line") {
        expect(entityIds.has(entity.startPointId)).toBe(true)
        expect(entityIds.has(entity.endPointId)).toBe(true)
      }
    const applied = success(
      prepareAuthorityTransaction(
        target(),
        prepared.transaction,
        (requirement, _feature, ordinal) => ({
          id: partIdSchema.parse(id(2000 + ordinal)),
          body: requirement.body,
          name: `Part ${ordinal}`,
          origin: requirement.origin,
        }),
      ),
    )
    expect(applied.snapshot.features).toHaveLength(1)
    expect(applied.snapshot.sketches).toHaveLength(1)
    expect(applied.snapshot.variables).toHaveLength(2)
    expect(applied.snapshot.history.map((item) => item.kind)).toEqual(["sketch", "feature"])
    expect(new Set(applied.events.map((event) => event.transactionId))).toEqual(
      new Set([draftIdSchema.parse(id(900))]),
    )
  })

  it("captures added identities after insertion and includes an earlier sketch dependency", () => {
    const base = model()
    const existing = {
      ...base.features[0],
      schemaVersion: 1,
      id: id(15),
      type: sphereFeatureType.type,
      parameters: { radius: createLengthQuantity(3) },
      dependencies: [],
      references: [],
      semanticInputs: [],
      suppressed: false,
    }
    const after = documentSnapshotV1Schema.parse({
      ...base,
      features: [...base.features, existing],
      history: [...base.history, { kind: "feature", id: id(15) }],
    })
    const before = documentSnapshotV1Schema.parse({
      ...after,
      features: [existing],
      history: [base.history[0], { kind: "feature", id: id(15) }],
    })
    const recording = success(startMacroRecording(before)).recording
    const stopped = success(stopMacroRecording(recording, after))
    expect(stopped.recordedCount).toBe(1)
    expect(stopped.dependencyCount).toBe(1)
    expect(stopped.recipe.history).toEqual(base.history)
    expect(stopped.recipe.features.map((feature) => feature.id)).toEqual([
      featureIdSchema.parse(id(11)),
    ])
    const other = documentSnapshotV1Schema.parse({ ...after, id: id(99) })
    expect(stopMacroRecording(recording, other)).toMatchObject({ ok: false })
    expect(stopMacroRecording(recording, before)).toMatchObject({ ok: false })
  })

  it("refuses broken dependencies, unsupported feature types, stale transactions and identity collisions without mutating the destination", () => {
    const recipe = success(exportDesignRecipe(model())).recipe
    expect(designRecipeSchema.safeParse({ ...recipe, sketches: [] }).success).toBe(false)
    expect(
      designRecipeSchema.safeParse({
        ...recipe,
        features: recipe.features.map((feature) => ({
          ...feature,
          type: { ...feature.type, typeId: "org.example.feature.missing" },
        })),
      }).success,
    ).toBe(false)
    expect(
      prepareDesignRecipeReplay(
        recipe,
        target(),
        { transactionId: id(900), issuedAt: timestamp, actor: { type: "user", userId: null } },
        () => id(1),
      ),
    ).toMatchObject({ ok: false })
    const prepared = success(replay(recipe))
    const unchanged = target()
    const failed = prepareAuthorityTransaction(
      { ...unchanged, revision: 3 },
      prepared.transaction,
      () => {
        throw new Error("must not allocate")
      },
    )
    expect(failed.ok).toBe(false)
    expect(unchanged.revision).toBe(2)
  })

  it("refuses native-only authored metadata rather than dropping it", () => {
    const base = target()
    const source = model()
    const metadata = documentSnapshotV2Schema.parse({
      ...source,
      schemaVersion: 2,
      folders: [],
      parts: [
        {
          schemaVersion: 0,
          id: id(500),
          name: "Custom authored name",
          visible: true,
          origin: "independent",
          bodyHistory: [{ schemaVersion: 0, featureId: id(11), outputRole: "result" }],
          consumedBy: null,
        },
      ],
    })
    expect(exportDesignRecipe(metadata)).toMatchObject({
      ok: false,
      message: expect.stringContaining("part naming"),
    })
    expect(exportDesignRecipe(base).ok).toBe(true)
  })

  it("does not share feature IDs across independent replays", () => {
    const recipe = success(exportDesignRecipe(model())).recipe
    const a = success(replay(recipe, 1000))
    const b = success(replay(recipe, 3000))
    expect(a.recipe.features[0]?.id).not.toBe(b.recipe.features[0]?.id)
    expect(a.recipe.features[0]?.type).toEqual(extrusionFeatureType.type)
    const sphere = {
      ...recipe.features[0],
      type: sphereFeatureType.type,
      parameters: { radius: createLengthQuantity(3) },
      semanticInputs: [],
      dependencies: [],
      references: [],
    }
    expect(designRecipeSchema.safeParse({ ...recipe, features: [sphere] }).success).toBe(true)
  })

  it("publishes forward-referencing variables together without borrowing destination expressions", () => {
    const recipe = success(exportDesignRecipe(model())).recipe
    const prepared = success(
      replay({
        ...recipe,
        variables: [
          { schemaVersion: 0, id: id(30), name: "diameter", expression: "#width * 2" },
          ...recipe.variables,
        ],
      }),
    )
    const applied = success(
      prepareAuthorityTransaction(
        target(),
        prepared.transaction,
        (requirement, _feature, ordinal) => ({
          id: partIdSchema.parse(id(4000 + ordinal)),
          body: requirement.body,
          name: `Part ${ordinal}`,
          origin: requirement.origin,
        }),
      ),
    )
    expect(applied.snapshot.variables).toMatchObject([
      { name: "width", expression: "50 mm" },
      { name: "diameter", expression: "#width_recipe1 * 2" },
      { name: "width_recipe1", expression: "20 mm" },
    ])
  })
})
