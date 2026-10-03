import {
  applyDocumentUpgradeV2Command,
  applyDocumentV2Command,
  applyVersionedDocumentCommand,
  boxFeatureType,
  createDefaultSurfaceTextureLayer,
  createLengthQuantity,
  featureIdSchema,
  surfaceTextureLayerIdSchema,
} from "../../packages/domain/src/index"

export const textureFixtureId = (n: number) =>
  `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
export const textureFixtureTimestamp = "2026-10-03T00:00:00Z"
export function textureSuccess<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
export function textureFixtureEnvelope(revision: number, command = revision + 10) {
  return {
    commandId: textureFixtureId(command),
    documentId: textureFixtureId(1),
    baseRevision: revision,
    issuedAt: textureFixtureTimestamp,
    actor: { type: "user", userId: null } as const,
  }
}
export function surfaceTextureProjectFixture() {
  const created = textureSuccess(
    applyVersionedDocumentCommand(null, {
      ...textureFixtureEnvelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Textured housing" },
    }),
  )
  const upgraded = textureSuccess(
    applyDocumentUpgradeV2Command(created.snapshot, {
      ...textureFixtureEnvelope(1),
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  )
  const added = textureSuccess(
    applyDocumentV2Command(upgraded.snapshot, {
      ...textureFixtureEnvelope(2),
      schemaVersion: 2,
      kind: "org.vibeshape.document.model-command",
      payload: {
        command: {
          ...textureFixtureEnvelope(2),
          schemaVersion: 1,
          kind: "org.vibeshape.history.insert-feature",
          payload: {
            historyAfter: null,
            feature: {
              schemaVersion: 0,
              id: textureFixtureId(200),
              type: boxFeatureType.type,
              label: "Housing",
              parameters: {
                width: createLengthQuantity(20),
                depth: createLengthQuantity(30),
                height: createLengthQuantity(40),
                centered: false,
              },
              dependencies: [],
              references: [],
              suppressed: false,
            },
          },
        },
        partAllocations: [
          {
            id: textureFixtureId(100),
            name: "Housing",
            origin: "independent",
            body: { schemaVersion: 0, featureId: textureFixtureId(200), outputRole: "result" },
          },
        ],
      },
    }),
  )
  const layer = createDefaultSurfaceTextureLayer(
    featureIdSchema.parse(textureFixtureId(200)),
    "result",
    surfaceTextureLayerIdSchema.parse(textureFixtureId(400)),
  )
  return {
    snapshot: added.snapshot,
    layer,
    events: [created.event, upgraded.event, added.event],
    portable: {
      snapshot: added.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: [created.event, upgraded.event, added.event],
      historyMode: "complete",
      promotionRevision: 0,
      upgradeRevision: 2,
      migrationDiagnostic: null,
      unavailableRecords: [],
      exportedAt: textureFixtureTimestamp,
      createdBy: { application: "VibeShape", version: "test", build: null },
      engine: null,
    },
  }
}
