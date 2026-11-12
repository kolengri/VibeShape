import "../../../../../tests/unit/support/dom"
import { describe, expect, it } from "bun:test"
import { act, render, renderHook } from "@testing-library/react"
import { featureIdSchema } from "@vibeshape/domain"
import { modelBodyTopologyEvidenceSchema } from "@vibeshape/domain/model-body-topology"
import { useCallback } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"
import { BodyFacePickingSync } from "./body-face-selection"
import type { ShellPickingContext } from "./shell-picking"
import { useShellFacePicking } from "./use-shell-face-picking"

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7801")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7802")
const evidence = modelBodyTopologyEvidenceSchema.parse({
  schemaVersion: 1,
  documentId: sourceId,
  revision: 7,
  generation: 7,
  rebuildId: "shell-picking",
  featureId: sourceId,
  contentHash: "a".repeat(64),
  outputRole: "result",
  kind: "face",
  candidates: [
    {
      candidateId: "top",
      kind: "face",
      semanticRole: "box:top",
      lineageTokens: [],
      signature: {
        kind: "face",
        geometryClass: "plane",
        measure: 600,
        centroid: [0, 0, 40],
        bounds: { min: [-10, -15, 40], max: [10, 15, 40] },
        boundaryCount: 4,
        adjacentGeometryClasses: [],
      },
    },
  ],
})
const context: ShellPickingContext = {
  featureId,
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "result" },
  evidence,
  openingIds: ["top"],
}
const mesh = {
  positions: new Float32Array(),
  normals: new Float32Array(),
  indices: new Uint32Array(),
  triangleFaceIds: new Uint32Array(),
}
function controller(saveStatus: DocumentControllerState["saveStatus"] = "saved") {
  return {
    saveStatus,
    report: {
      mode: "read-write",
      snapshot: { id: sourceId, revision: 7, features: [] },
      rebuild: {
        ok: true,
        response: {
          geometry: [
            {
              featureId: sourceId,
              contentHash: evidence.contentHash,
              geometry: {
                bodies: [
                  {
                    outputRole: "result",
                    mesh,
                    topologyCandidates: [{ ...evidence.candidates[0], meshFaceId: 42 }],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  } as unknown as DocumentControllerState
}
const tool: ActivePartDesignTool = { kind: "edit-shell", featureId }
const picked = { featureId: sourceId, outputRole: "result", faceId: 42, faceOrdinal: 1 }

describe("Shell viewport opening selection", () => {
  it("maps a current mesh face to exact body evidence and highlights authored openings", () => {
    const hook = renderHook(() => useShellFacePicking(controller(), tool, []))
    act(() => hook.result.current.onContextChange(context))
    const selection = hook.result.current.viewportContext?.faceIntersectionSelection
    expect(selection?.selectedFaces).toEqual([picked])
    act(() => selection?.onSelect(picked))
    expect(hook.result.current.request).toMatchObject({
      candidateId: "top",
      sourceContentHash: evidence.contentHash,
      featureId,
    })
    expect(hook.result.current.request).not.toHaveProperty("faceId")
    act(() => selection?.onSelect({ ...picked, outputRole: "other" }))
    expect(hook.result.current.request?.sequence).toBe(1)
    act(() => selection?.onSelect({ ...picked, faceId: 99 }))
    expect(hook.result.current.request?.sequence).toBe(1)
    act(() => selection?.onSelect(picked))
    expect(hook.result.current.request?.sequence).toBe(2)
  })
  it("disables the picker during saving, hidden source, and stale source evidence", () => {
    const hook = renderHook(({ state, hidden }) => useShellFacePicking(state, tool, hidden), {
      initialProps: { state: controller(), hidden: [] as string[] },
    })
    act(() => hook.result.current.onContextChange(context))
    hook.rerender({ state: controller("saving"), hidden: [] })
    expect(hook.result.current.viewportContext).toBeUndefined()
    hook.rerender({ state: controller(), hidden: [sourceId] })
    expect(hook.result.current.viewportContext).toBeUndefined()
    hook.rerender({ state: controller(), hidden: [] })
    act(() =>
      hook.result.current.onContextChange({
        ...context,
        evidence: { ...evidence, contentHash: "b".repeat(64) },
      }),
    )
    expect(hook.result.current.viewportContext).toBeUndefined()
  })
  it("releases source overlays and requests when the Shell task closes", () => {
    const hook = renderHook(({ active }) => useShellFacePicking(controller(), active, []), {
      initialProps: { active: tool as ActivePartDesignTool | null },
    })
    act(() => hook.result.current.onContextChange(context))
    act(() => hook.result.current.viewportContext?.faceIntersectionSelection?.onSelect(picked))
    hook.rerender({ active: null })
    expect(hook.result.current.viewportContext).toBeUndefined()
    expect(hook.result.current.request).toBeNull()
    hook.rerender({ active: tool })
    act(() => hook.result.current.onContextChange(context))
    expect(hook.result.current.viewportContext?.faceIntersectionSelection).toBeDefined()
    expect(hook.result.current.request).toBeNull()
    act(() => hook.result.current.viewportContext?.faceIntersectionSelection?.onSelect(picked))
    expect(hook.result.current.request).toMatchObject({ candidateId: "top", sequence: 1 })
  })
  it("ignores an equal but newly allocated picking context from a re-rendered task", () => {
    let renders = 0
    const state = controller()
    const selectedIds = ["top"]
    function Workspace({ source }: { source: typeof evidence }) {
      renders += 1
      const picking = useShellFacePicking(state, tool, [])
      const store = picking.onContextChange
      // Bounded so a regression fails the assertion instead of looping the runner.
      const publish = useCallback(
        (next: ShellPickingContext | null) => {
          if (renders < 25) store(next)
        },
        [store],
      )
      return (
        <BodyFacePickingSync
          enabled
          evidence={source}
          featureId={featureId}
          target={{ schemaVersion: 0, featureId: sourceId, outputRole: "result" }}
          selectedIds={selectedIds}
          request={null}
          onContextChange={publish}
          pick={() => null}
          onSelectionChange={() => undefined}
        />
      )
    }
    const view = render(<Workspace source={evidence} />)
    const settled = renders
    // A parent that rebuilds its report hands the task equal evidence in a new object.
    view.rerender(<Workspace source={structuredClone(evidence)} />)
    expect(renders).toBe(settled + 1)
    view.unmount()
  })
})
