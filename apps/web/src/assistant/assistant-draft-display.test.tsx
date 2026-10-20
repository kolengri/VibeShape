import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"
import { automationDraftPreviewSchema } from "@vibeshape/automation-api/drafts"
import type { DraftReviewInput } from "@vibeshape/automation-host/host"
import {
  commandActorSchema,
  createEmptySketch,
  type DocumentSnapshot,
  documentSnapshotSchema,
  draftIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } from "@vibeshape/protocol"
import type { ReactNode } from "react"
import type { AutomationDraftViewport } from "../automation/automation-draft-viewport"
import {
  getActiveAutomationReviews,
  setActiveAutomationReviews,
} from "../automation/automation-review-controller"
import { createAutomationReviewController } from "../automation/automation-review-state"
import type { DocumentControllerState } from "../document/document-controller"
import {
  EditorSessionProvider,
  useEditorSessionStoreApi,
} from "../editor-session/editor-session-provider"
import { authoredTreeFixture } from "../test-support/authored-tree-fixture"
import { useAssistantDraftDisplay } from "./assistant-draft-display"

const id = (suffix: number) => `0195b5ac-b220-7a2c-8c33-${suffix.toString(16).padStart(12, "0")}`
const timestamp = "2026-10-20T12:00:00.000Z"
let previousReviews = getActiveAutomationReviews()

beforeEach(() => {
  previousReviews = getActiveAutomationReviews()
  setActiveAutomationReviews(createAutomationReviewController())
})

afterEach(() => {
  cleanup()
  setActiveAutomationReviews(previousReviews)
})

function emptyRebuild(snapshot: DocumentSnapshot) {
  const response = documentWorkerResponseSchema.parse({
    type: "documentRebuilt",
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: id(90),
    generation: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    evaluation: {
      records: [],
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
    geometry: [],
    sketches: [],
    modelReferenceEvidence: [],
  })
  if (response.type !== "documentRebuilt") throw new Error("Expected a fixture rebuild.")
  return response
}

function controllerFor(snapshot: DocumentSnapshot): DocumentControllerState {
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    history: { canUndo: true, canRedo: false },
    report: {
      status: "clean",
      mode: "read-write",
      snapshot,
      historyItems: [],
      rebuild: { ok: true, response: emptyRebuild(snapshot) },
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: null,
    },
  }
}

function fixture(project = 1) {
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(project),
    revision: 3,
    name: `Project ${project}`,
    features: [],
    sketches: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const draft = {
    schemaVersion: 1 as const,
    draftId: draftIdSchema.parse(id(project + 100)),
    documentId: snapshot.id,
    baseRevision: snapshot.revision,
    revision: snapshot.revision + 1,
    commandCount: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  const viewport: AutomationDraftViewport = {
    draft,
    generation: 1,
    preview: {
      status: "ready",
      display: "result",
      assistantDraft: {
        documentId: draft.documentId,
        draftId: draft.draftId,
        baseRevision: draft.baseRevision,
      },
      meshes: [
        {
          featureId: id(project + 200),
          outputRole: "result",
          appearance: "preview",
          previewMaterial: "model",
          positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2]),
          triangleFaceIds: new Uint32Array([1]),
        },
      ],
    },
  }
  return { snapshot, viewport, controller: controllerFor(snapshot), owner: Symbol("draft-owner") }
}

function reviewInput(viewport: AutomationDraftViewport): DraftReviewInput {
  return {
    actor: commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.agent",
      sessionId: id(91),
    }),
    commands: [],
    preview: automationDraftPreviewSchema.parse({
      schemaVersion: 2,
      draft: viewport.draft,
      summary: {
        kind: "org.vibeshape.document.summary",
        schemaVersion: 1,
        documentId: viewport.draft.documentId,
        revision: viewport.draft.revision,
        classification: "semantic",
        truncated: false,
        data: { name: "Proposed result", createdAt: timestamp, updatedAt: timestamp },
      },
      geometry: {
        status: "valid",
        measurements: {
          kind: "org.vibeshape.model.measurements",
          schemaVersion: 1,
          documentId: viewport.draft.documentId,
          revision: viewport.draft.revision,
          generation: viewport.generation,
          classification: "derived",
          nextCursor: null,
          units: { length: "mm", area: "mm2", volume: "mm3" },
          data: { features: [], total: 0 },
        },
      },
    }),
  }
}

function renderDisplay(controller: DocumentControllerState) {
  return renderHook(
    ({ controller: current }) => ({
      display: useAssistantDraftDisplay(current),
      session: useEditorSessionStoreApi(),
    }),
    {
      initialProps: { controller },
      wrapper: ({ children }: { children: ReactNode }) => (
        <EditorSessionProvider>{children}</EditorSessionProvider>
      ),
    },
  )
}

describe("assistant draft display integration", () => {
  it("subscribes through the real proxy and changes only presentation metadata", () => {
    const f = fixture()
    const reviews = getActiveAutomationReviews()
    const view = renderDisplay(f.controller)
    expect(view.result.current.display).toBeUndefined()
    act(() => reviews.presentDraftViewport(f.owner, f.viewport))
    expect(view.result.current.display?.mode).toBe("result")
    const session = view.result.current.session.getState()
    const controller = structuredClone(f.controller)
    act(() => view.result.current.display?.onChange("changes"))
    const changed = reviews.getDraftViewportSnapshot()
    expect(view.result.current.display?.mode).toBe("changes")
    expect(changed?.preview.meshes).toBe(f.viewport.preview.meshes)
    expect(changed?.draft).toBe(f.viewport.draft)
    expect(changed?.preview.meshes[0]?.appearance).toBe("preview")
    expect(view.result.current.session.getState()).toBe(session)
    expect(f.controller).toEqual(controller)
    expect(reviews.getSnapshot()).toBeNull()
    act(() => view.result.current.display?.onChange("result"))
    expect(view.result.current.display?.mode).toBe("result")
  })

  it.each(["document", "base revision", "missing report"] as const)(
    "hides a draft with a mismatched %s until its committed source matches",
    (fence) => {
      const f = fixture()
      getActiveAutomationReviews().presentDraftViewport(f.owner, f.viewport)
      const snapshot = {
        ...f.snapshot,
        ...(fence === "document"
          ? { id: documentSnapshotSchema.parse({ ...f.snapshot, id: id(2) }).id }
          : {}),
        ...(fence === "base revision" ? { revision: f.snapshot.revision + 1 } : {}),
      }
      const controller =
        fence === "missing report" ? { ...f.controller, report: null } : controllerFor(snapshot)
      const view = renderDisplay(controller)
      expect(view.result.current.display).toBeUndefined()
      view.rerender({ controller: f.controller })
      expect(view.result.current.display?.mode).toBe("result")
    },
  )

  it("retains Changes across incremental updates and ignores a callback from a replaced draft", () => {
    const f = fixture()
    const reviews = getActiveAutomationReviews()
    reviews.presentDraftViewport(f.owner, f.viewport)
    const view = renderDisplay(f.controller)
    const oldDisplay = view.result.current.display
    act(() => oldDisplay?.onChange("changes"))
    const incremental = {
      ...f.viewport,
      generation: f.viewport.generation + 1,
      draft: { ...f.viewport.draft, revision: f.viewport.draft.revision + 1 },
      preview: { ...f.viewport.preview, meshes: [...f.viewport.preview.meshes] },
    }
    act(() => reviews.presentDraftViewport(f.owner, incremental))
    expect(view.result.current.display?.mode).toBe("changes")
    const draft = { ...incremental.draft, draftId: draftIdSchema.parse(id(999)) }
    act(() =>
      reviews.presentDraftViewport(f.owner, {
        ...incremental,
        draft,
        preview: { ...incremental.preview, assistantDraft: draft },
      }),
    )
    expect(view.result.current.display?.mode).toBe("result")
    act(() => oldDisplay?.onChange("changes"))
    expect(view.result.current.display?.mode).toBe("result")
    expect(reviews.getDraftViewportSnapshot()?.draft.draftId).toBe(draft.draftId)
  })

  it("removes a discarded source and does not recreate it through a stale callback", () => {
    const f = fixture()
    const reviews = getActiveAutomationReviews()
    reviews.presentDraftViewport(f.owner, f.viewport)
    const view = renderDisplay(f.controller)
    const display = view.result.current.display
    act(() => reviews.clearDraftViewport(f.owner))
    expect(view.result.current.display).toBeUndefined()
    act(() => display?.onChange("changes"))
    expect(reviews.getDraftViewportSnapshot()).toBeNull()
    act(() => reviews.presentDraftViewport(f.owner, f.viewport))
    expect(view.result.current.display?.mode).toBe("result")
  })

  it.each(["feature", "sketch"] as const)(
    "hides the display while %s editing is active without losing the selected mode",
    (editing) => {
      const f = fixture()
      getActiveAutomationReviews().presentDraftViewport(f.owner, f.viewport)
      const view = renderDisplay(f.controller)
      act(() => view.result.current.display?.onChange("changes"))
      const actions = view.result.current.session.getState().actions
      act(() => {
        if (editing === "feature") actions.startPartDesignTool({ kind: "create-box" })
        else
          actions.beginSketchCreate(
            createEmptySketch({
              id: sketchIdSchema.parse(id(300)),
              label: "Sketch",
              plane: "xy",
            }),
          )
      })
      expect(view.result.current.display).toBeUndefined()
      act(() => actions.closeActiveTool())
      expect(view.result.current.display?.mode).toBe("changes")
    },
  )

  it("hides display controls during a checkpoint presentation and restores the retained mode", () => {
    const { snapshot, authority } = authoredTreeFixture()
    const f = fixture()
    const controller = controllerFor(snapshot)
    const draft = {
      ...f.viewport.draft,
      documentId: snapshot.id,
      baseRevision: snapshot.revision,
      revision: snapshot.revision + 1,
    }
    getActiveAutomationReviews().presentDraftViewport(f.owner, {
      ...f.viewport,
      draft,
      preview: { ...f.viewport.preview, assistantDraft: draft },
    })
    const view = renderDisplay(controller)
    act(() => view.result.current.display?.onChange("changes"))
    view.rerender({
      controller: {
        ...controller,
        assistantCheckpointPresentation: {
          kind: "assistant-checkpoint",
          documentId: snapshot.id,
          baseRevision: snapshot.revision,
          target: { snapshot, authority, targetRevision: snapshot.revision },
          rebuild: emptyRebuild(snapshot),
          assembly: null,
        },
      },
    })
    expect(view.result.current.display).toBeUndefined()
    view.rerender({ controller })
    expect(view.result.current.display?.mode).toBe("changes")
  })

  it("isolates project owners when the active proxy and visible document change", () => {
    const first = fixture(1)
    const second = fixture(2)
    const reviewsA = getActiveAutomationReviews()
    const reviewsB = createAutomationReviewController()
    reviewsA.presentDraftViewport(first.owner, first.viewport)
    reviewsB.presentDraftViewport(second.owner, second.viewport)
    const view = renderDisplay(first.controller)
    const displayA = view.result.current.display
    act(() => displayA?.onChange("changes"))
    act(() => setActiveAutomationReviews(reviewsB))
    expect(view.result.current.display).toBeUndefined()
    view.rerender({ controller: second.controller })
    expect(view.result.current.display?.mode).toBe("result")
    act(() => displayA?.onChange("changes"))
    expect(reviewsB.getDraftViewportSnapshot()?.preview.display).toBe("result")
    act(() => setActiveAutomationReviews(reviewsA))
    expect(view.result.current.display).toBeUndefined()
    view.rerender({ controller: first.controller })
    expect(view.result.current.display?.mode).toBe("changes")
  })

  it("changes a pending review's display without deciding or mutating its saved document", async () => {
    const f = fixture()
    const reviews = getActiveAutomationReviews()
    const decision = reviews.request(f.owner, reviewInput(f.viewport), f.viewport)
    const original = reviews.getSnapshot()
    if (!original) throw new Error("Expected pending review.")
    const view = renderDisplay(f.controller)
    let decided = false
    void decision.then(() => {
      decided = true
    })
    act(() => view.result.current.display?.onChange("changes"))
    await Promise.resolve()
    expect(view.result.current.display?.mode).toBe("changes")
    expect(decided).toBe(false)
    expect(reviews.getSnapshot()).toMatchObject({ id: original.id, status: "ready" })
    expect(reviews.getSnapshot()?.input).toBe(original.input)
    expect(reviews.getSnapshot()?.draftViewport?.preview.meshes).toBe(f.viewport.preview.meshes)
    expect(f.controller.report?.snapshot).toBe(f.snapshot)
    act(() => reviews.cancel(f.owner))
    await expect(decision).resolves.toBe("cancelled")
    expect(view.result.current.display).toBeUndefined()
  })
})
