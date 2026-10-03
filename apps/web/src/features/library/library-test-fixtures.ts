import { featureGeometryRecordSchema } from "@vibeshape/application/feature-rebuild"
import {
  captureAssemblyDefinition,
  emptyAssemblyAuthority,
} from "@vibeshape/domain/assembly-authority"
import {
  assemblyLibraryItemSchema,
  assemblyLibraryVersionSchema,
} from "@vibeshape/domain/assembly-library"
import { documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import type { AssemblyLibraryVersionRead } from "@vibeshape/persistence/assembly-library-store"
import type { DocumentControllerState } from "../../document/document-controller"
import {
  authoredTestBody,
  authoredTreeFixture,
  authoredTestId as id,
} from "../../test-support/authored-tree-fixture"
import { identityAssemblyPose } from "../assembly/assembly-model"

const tree = authoredTreeFixture()
const first = tree.authority.parts[0]
const body = first?.bodyHistory[0]
if (!first || !body) throw new Error("Library tests require an authored source Part.")
export const librarySourcePartId = first.id
const frozenLibraryDefinition = captureAssemblyDefinition(
  documentSnapshotV4Schema.parse({
    ...tree.authority,
    schemaVersion: 4,
    surfaceTextures: [],
    assets: [],
  }),
  {
    schemaVersion: 1,
    id: id(600),
    name: "Bracket definition",
    sourceFrame: identityAssemblyPose,
    sources: [{ kind: "part", partId: first.id, body, contentHash: "a".repeat(64) }],
  },
)
export const libraryItem = assemblyLibraryItemSchema.parse({
  schemaVersion: 1,
  id: id(700),
  metadataRevision: 3,
  headVersion: 2,
  name: "Bracket",
  tags: ["Print", "Mount"],
  createdAt: tree.authority.createdAt,
  updatedAt: tree.authority.updatedAt,
})
export function libraryRead(version = 2): AssemblyLibraryVersionRead {
  return {
    item: libraryItem,
    version: assemblyLibraryVersionSchema.parse({
      schemaVersion: 1,
      itemId: libraryItem.id,
      version,
      createdAt: libraryItem.createdAt,
      definition: frozenLibraryDefinition,
      contentDigest: "a".repeat(64),
    }),
    blobs: [{ digest: "b".repeat(64), bytes: new Uint8Array([1, 2, 3]) }],
  }
}
export function libraryController(bound = false): DocumentControllerState {
  const authority = documentSnapshotV4Schema.parse({
    ...tree.authority,
    schemaVersion: 4,
    surfaceTextures: [],
    assets: [],
    assembly: {
      ...emptyAssemblyAuthority(),
      definitions: [
        {
          ...frozenLibraryDefinition,
          ...(bound ? { libraryBinding: { itemId: libraryItem.id, version: 1 } } : {}),
        },
      ],
    },
  })
  return {
    status: "ready",
    saveStatus: "saved",
    authoredSnapshot: authority,
    report: {
      mode: "read-write",
      snapshot: tree.snapshot,
      rebuild: {
        ok: true,
        response: {
          documentId: authority.id,
          revision: authority.revision,
          evaluation: {
            records: authority.features.map(({ id: featureId }) => ({
              featureId,
              status: "succeeded",
              contentHash: "a".repeat(64),
            })),
            dirtyFeatureIds: [],
            evaluatedFeatureIds: [],
            reusedFeatureIds: [],
          },
          geometry: authority.parts.map((part) => {
            const {
              featureId,
              outputRole: _role,
              contentHash,
              ...geometry
            } = authoredTestBody(part)
            return featureGeometryRecordSchema.parse({
              featureId,
              contentHash,
              meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
              geometry: {
                ...geometry,
                engine: {
                  adapter: "replicad",
                  adapterVersion: "library-ui-fixture",
                  replicadVersion: "fixture",
                  opencascadePackageVersion: "fixture",
                  opencascadeSourceRevision: null,
                  wasmBytes: 0,
                  initializedInMs: 0,
                  featureContentEnvironment: {
                    schemaVersion: 0,
                    hostApiVersion: "0.1.0",
                    geometry: {
                      adapterId: "org.vibeshape.geometry.replicad",
                      adapterVersion: "library-ui-fixture",
                      kernelId: "org.opencascade.occt",
                      kernelVersion: "fixture",
                      kernelSourceRevision: null,
                    },
                    modelingTolerancePolicyVersion: 1,
                    provider: { kind: "built-in" },
                  },
                },
                cache: { brepHit: false },
                timings: { evaluationMs: 0, tessellationMs: 0, totalMs: 0 },
              },
            })
          }),
        },
      },
    },
  } as unknown as DocumentControllerState
}
