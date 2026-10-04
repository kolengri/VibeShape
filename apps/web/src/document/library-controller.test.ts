import {
  applyCapturedAssemblyMutations,
  captureAssemblyMutations,
  projectAssemblyAuthority,
  upgradeAssemblyAuthority,
} from "@vibeshape/domain/assembly-authority"
import {
  assemblyFrameBindingSchema,
  assemblyMateJointSchema,
} from "@vibeshape/domain/assembly-mates"
import { documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { resolveAssemblyMateFrames } from "../../../../packages/application/src/assembly-mate-frames"
import { identityAssemblyPose } from "../features/assembly/assembly-model"
import {
  libraryController,
  libraryItem,
  libraryRead,
} from "../features/library/library-test-fixtures"
import { authoredTestId as id } from "../test-support/authored-tree-fixture"
import { insertLocalLibraryVersion, relinkActiveLibraryDefinition } from "./library-controller"

const ports = vi.hoisted(() => ({
  state: vi.fn(),
  block: vi.fn(),
  preview: vi.fn(),
  commit: vi.fn(),
  read: vi.fn(),
}))
vi.mock("./document-controller", () => ({
  getDocumentControllerState: ports.state,
  getProjectActionBlock: ports.block,
  previewAssemblyChanges: ports.preview,
  commitAuthoredTransaction: ports.commit,
}))
vi.mock("./browser-library-repository", () => ({
  localLibrary: () => ({ readVersion: ports.read }),
}))

function v2Controller() {
  const controller = libraryController(true)
  const authority = controller.authoredSnapshot
  if (authority?.schemaVersion !== 4) throw new Error("Expected an authored library fixture.")
  const definition = authority.assembly.definitions[0]
  const body = definition?.pinnedModels[0]?.selectedBody
  if (!definition || !body) throw new Error("Expected a pinned library source.")
  const binding = assemblyFrameBindingSchema.parse({
    sourceIndex: 0,
    pinRevision: 1,
    body,
    reference: {
      schemaVersion: 0,
      featureId: body.featureId,
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
    geometry: "planar-face",
    originHint: [0, 0, 0],
    xDirection: [1, 0, 0],
    reversed: false,
  })
  const assembly = upgradeAssemblyAuthority(authority.assembly)
  const authoredSnapshot = documentSnapshotV4Schema.parse({
    ...authority,
    assembly: {
      ...assembly,
      instances: [
        {
          schemaVersion: 2,
          id: id(901),
          definitionId: definition.id,
          name: "Base",
          grounded: true,
          worldFrame: identityAssemblyPose,
        },
        {
          schemaVersion: 2,
          id: id(902),
          definitionId: definition.id,
          name: "Moving",
          grounded: false,
          initialFrame: identityAssemblyPose,
        },
      ],
      joints: [
        assemblyMateJointSchema.parse({
          schemaVersion: 2,
          id: id(903),
          kind: "ball",
          parentInstanceId: id(901),
          childInstanceId: id(902),
          parentFrame: identityAssemblyPose,
          childFrame: identityAssemblyPose,
          childBinding: binding,
        }),
      ],
    },
  })
  return { controller: { ...controller, authoredSnapshot }, definition, binding }
}
beforeEach(() => {
  vi.clearAllMocks()
  ports.block.mockReturnValue(null)
  ports.read.mockResolvedValue({ ok: true, value: libraryRead() })
  ports.preview.mockResolvedValue({ ok: true, inspection: { occurrences: [], interference: [] } })
  ports.commit.mockResolvedValue({ ok: true })
})
describe("library UI general mate preflight", () => {
  it("rejects relinking unchanged geometry to a new pin before publishing a stale bound joint", async () => {
    const f = v2Controller()
    ports.state.mockReturnValue(f.controller)
    ports.preview.mockImplementation(async (changes) => {
      const source = f.controller.authoredSnapshot
      if (source?.schemaVersion !== 4) throw new Error("Expected authored authority.")
      const captured = captureAssemblyMutations(source, source.assembly, changes)
      const assembly = applyCapturedAssemblyMutations(source.assembly, captured)
      const graph = projectAssemblyAuthority(assembly)
      if (graph.schemaVersion !== 2) throw new Error("Expected general mates.")
      const resolved = resolveAssemblyMateFrames(graph, assembly.definitions, [])
      if (resolved.ok) throw new Error("Expected the original pin to be stale.")
      return {
        ok: false,
        diagnostic: {
          code: "export-failed",
          sourceCode: "assembly-operation-failed",
          message: resolved.message,
          retryable: false,
          assembly: { code: resolved.code, jointIds: resolved.jointIds },
        },
      }
    })
    expect(
      await relinkActiveLibraryDefinition({
        definitionId: f.definition.id,
        itemId: libraryItem.id,
        version: 2,
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { assembly: { code: "topology-stale", jointIds: [id(903)] } },
    })
    expect(ports.preview).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "definition.relink-pinned",
          definition: expect.objectContaining({ pinRevision: 2 }),
        }),
      ]),
      f.controller.authoredSnapshot?.revision,
      libraryRead().blobs,
    )
    expect(ports.commit).not.toHaveBeenCalled()
    expect(f.binding.pinRevision).toBe(1)
  })
  it("passes owned bytes through v2 insertion preview and retains ordinary commit CAS", async () => {
    const f = v2Controller()
    ports.state.mockReturnValue(f.controller)
    expect(
      await insertLocalLibraryVersion({
        itemId: libraryItem.id,
        version: 2,
        mode: "copy",
        definitionName: "Copy",
        instanceName: "Copy occurrence",
      }),
    ).toEqual({ ok: true })
    expect(ports.preview).toHaveBeenCalledWith(
      expect.any(Array),
      f.controller.authoredSnapshot?.revision,
      libraryRead().blobs,
    )
    expect(ports.preview.mock.invocationCallOrder[0]).toBeLessThan(
      ports.commit.mock.invocationCallOrder[0] ?? 0,
    )
    expect(ports.commit).toHaveBeenCalledWith(
      f.controller.authoredSnapshot?.revision,
      expect.objectContaining({ assetBlobs: libraryRead().blobs }),
    )
  })
  it("does not commit an insertion whose exact preflight fails", async () => {
    ports.state.mockReturnValue(v2Controller().controller)
    ports.preview.mockResolvedValue({
      ok: false,
      diagnostic: {
        code: "export-failed",
        message: "Conflicting mates.",
        retryable: false,
        sourceCode: "assembly-operation-failed",
        assembly: { code: "conflicting-mates", jointIds: [id(903)] },
      },
    })
    expect(
      await insertLocalLibraryVersion({
        itemId: libraryItem.id,
        version: 2,
        mode: "reference",
        definitionName: "Reference",
        instanceName: "Reference occurrence",
      }),
    ).toMatchObject({ ok: false, diagnostic: { assembly: { code: "conflicting-mates" } } })
    expect(ports.commit).not.toHaveBeenCalled()
  })
  it("retains the immutable v1 insertion path", async () => {
    const f = libraryController()
    ports.state.mockReturnValue(f)
    expect(
      await insertLocalLibraryVersion({
        itemId: libraryItem.id,
        version: 2,
        mode: "copy",
        definitionName: "Copy",
        instanceName: "Occurrence",
      }),
    ).toEqual({ ok: true })
    expect(ports.preview).not.toHaveBeenCalled()
    expect(ports.commit).toHaveBeenCalledOnce()
  })
})
