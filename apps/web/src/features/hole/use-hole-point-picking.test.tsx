// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import {
  documentIdSchema,
  featureIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { describe, expect, it } from "vitest"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import type { ActivePartDesignTool } from "../part-design/part-design-tool"
import type { HolePickingContext } from "./hole-form"
import { useHolePointPicking } from "./use-hole-point-picking"

const documentId = documentIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4801")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4802")
const firstSketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4803")
const secondSketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4804")
const firstPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4805")
const secondPointId = sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4806")

function sketch(id: typeof firstSketchId, pointId: typeof firstPointId) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id,
    label: "Hole centers",
    plane: "xy",
    entities: [{ schemaVersion: 0, id: pointId, type: "point", x: 0, y: 0, construction: false }],
    constraints: [],
  })
}

const firstSketch = sketch(firstSketchId, firstPointId)
const secondSketch = sketch(secondSketchId, secondPointId)
const activeTool: ActivePartDesignTool = { kind: "edit-hole", featureId }

function controller(saveStatus: DocumentControllerState["saveStatus"] = "saved") {
  return {
    status: "ready",
    saveStatus,
    diagnostic: null,
    report: {
      mode: "read-write",
      snapshot: { id: documentId, revision: 7, sketches: [firstSketch, secondSketch] },
      rebuild: {
        ok: true,
        response: {
          documentId,
          revision: 7,
          sketches: [
            {
              sketchId: firstSketchId,
              solvedPoints: [{ entityId: firstPointId, position: [1, 2, 3] }],
            },
            {
              sketchId: secondSketchId,
              solvedPoints: [{ entityId: secondPointId, position: [4, 5, 6] }],
            },
          ],
        },
      },
    },
  } as unknown as DocumentControllerState
}

function context(sketchId: typeof firstSketchId): HolePickingContext {
  return { featureId, sketchId, pointIds: [] }
}

function wrapper({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      {children}
    </I18nProvider>
  )
}

function selectFirstCandidate(
  hook: ReturnType<
    typeof renderHook<
      ReturnType<typeof useHolePointPicking>,
      { controller: DocumentControllerState }
    >
  >,
) {
  const selection = hook.result.current.viewportContext?.referenceSelection
  const candidate = selection?.candidates[0]
  expect(selection).toBeTruthy()
  expect(candidate).toBeTruthy()
  if (!selection || !candidate) throw new Error("Expected a Hole point selection candidate.")
  act(() => selection.onSelect(candidate))
}

describe("useHolePointPicking", () => {
  it("keeps picking requests monotonic across point-change cleanup and a sketch switch", () => {
    const hook = renderHook(
      ({ controller: currentController }) => useHolePointPicking(currentController, activeTool, []),
      { initialProps: { controller: controller() }, wrapper },
    )

    act(() => hook.result.current.onContextChange(context(firstSketchId)))
    selectFirstCandidate(hook)
    expect(hook.result.current.request).toMatchObject({
      requestId: 1,
      sketchId: firstSketchId,
      pointId: firstPointId,
    })

    act(() => hook.result.current.onContextChange(null))
    act(() => hook.result.current.onContextChange(context(firstSketchId)))
    selectFirstCandidate(hook)
    expect(hook.result.current.request).toMatchObject({
      requestId: 2,
      sketchId: firstSketchId,
      pointId: firstPointId,
    })

    act(() => hook.result.current.onContextChange(context(secondSketchId)))
    selectFirstCandidate(hook)
    expect(hook.result.current.request).toMatchObject({
      requestId: 3,
      sketchId: secondSketchId,
      pointId: secondPointId,
    })
  })

  it("rejects a click from a viewport closure made stale by saving", () => {
    const hook = renderHook(
      ({ controller: currentController }) => useHolePointPicking(currentController, activeTool, []),
      { initialProps: { controller: controller() }, wrapper },
    )
    act(() => hook.result.current.onContextChange(context(firstSketchId)))
    const staleSelection = hook.result.current.viewportContext?.referenceSelection
    const staleCandidate = staleSelection?.candidates[0]

    hook.rerender({ controller: controller("saving") })
    if (!staleSelection || !staleCandidate)
      throw new Error("Expected a Hole point selection candidate.")
    act(() => staleSelection.onSelect(staleCandidate))

    expect(hook.result.current.request).toBeNull()
    expect(hook.result.current.viewportContext).toBeUndefined()
  })
})
