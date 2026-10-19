import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test"
import type { ComponentProps } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"

const sortableCallbacks = (() => ({ current: null as unknown }))()

mock.module("@dnd-kit/react", () => ({
  DragDropProvider: (props: Record<string, unknown>) => {
    sortableCallbacks.current = props
    return props.children as import("react").ReactNode
  },
}))
mock.module("@dnd-kit/dom", () => ({
  Accessibility: class {},
  PointerActivationConstraints: {
    Delay: class {},
    Distance: class {},
  },
  PointerSensor: { configure: () => ({}) },
}))
mock.module("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({
    isDragSource: false,
    isDragging: false,
    isDropTarget: false,
    ref: () => undefined,
  }),
  isSortable: (value: unknown) =>
    typeof value === "object" && value !== null && "initialIndex" in value && "index" in value,
  isSortableOperation: (operation: { source: unknown; target: unknown }) =>
    operation.source !== null && operation.target !== null,
}))

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
)
const { default: userEvent } = await import("@testing-library/user-event")
const {
  boxFeatureType,
  createEmptySketch,
  createLengthQuantity,
  createSketchProfileSet,
  datumPlaneFeatureType,
  featureIdSchema,
  featureRecordSchema,
  filletFeatureType,
  legacyExtrusionFeatureType,
  multiProfileExtrusionFeatureType,
  projectDocumentSnapshotV1ToV0,
  sketchEntityIdSchema,
  sketchIdSchema,
  sketchRecordSchema,
} = await import("@vibeshape/domain")
const { projectDocumentSnapshotV2ToV1 } = await import("@vibeshape/domain/document-v2")
const { applyDocumentV2Command } = await import("@vibeshape/domain/document-v2-commands")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } = await import(
  "@vibeshape/protocol"
)
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { i18n } = await import("../i18n")
const { authoredTestBody, authoredTestId, authoredTreeFixture, requireAuthoredFixture } =
  await import("../test-support/authored-tree-fixture")
const { HistoryProfileSources } = await import("./history-profile-sources")
const { ModelTree } = await import("./model-tree")

type TestSortable = { id: string; index: number; initialIndex: number }
type TestOperation = { source: TestSortable | null; target: TestSortable | null }
type TestDragCallbacks = {
  onDragStart: (event: { operation: TestOperation }) => void
  onDragOver: (event: { operation: TestOperation }) => void
  onDragEnd: (event: { operation: TestOperation; canceled: boolean }) => void
}

function dragHistoryRow(
  sourceId: string,
  sourceIndex: number,
  targetId: string,
  targetIndex: number,
) {
  const callbacks = sortableCallbacks.current as TestDragCallbacks
  const source = { id: sourceId, index: sourceIndex, initialIndex: sourceIndex }
  const target = { id: targetId, index: targetIndex, initialIndex: targetIndex }
  act(() => callbacks.onDragStart({ operation: { source, target: null } }))
  act(() => callbacks.onDragOver({ operation: { source, target } }))
  act(() => callbacks.onDragEnd({ operation: { source, target }, canceled: false }))
}

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602")
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20, "mm", "20 mm"),
    depth: createLengthQuantity(20, "mm", "20 mm"),
    height: createLengthQuantity(20, "mm", "20 mm"),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Box 1",
})
const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2603")
const sketch = createEmptySketch({ id: sketchId, label: "Profile", plane: "xy" })
const datumFeature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2605"),
  type: datumPlaneFeatureType.type,
  parameters: {
    mode: "offset",
    support: { kind: "origin-plane", plane: "xz" },
    offset: createLengthQuantity(8),
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Offset plane",
})

const controller = {
  status: "ready",
  report: {
    mode: "read-write",
    snapshot: { features: [feature], revision: 7, sketches: [sketch] },
    rebuild: {
      ok: true,
      response: {
        evaluation: {
          records: [{ featureId, status: "succeeded", contentHash: "a".repeat(64) }],
          dirtyFeatureIds: [],
          evaluatedFeatureIds: [featureId],
          reusedFeatureIds: [],
        },
        geometry: [
          {
            featureId,
            contentHash: "a".repeat(64),
            meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
            geometry: {
              shape: { solidCount: 1 },
              mesh: {},
              topologyCandidates: [],
            },
          },
        ],
        modelReferenceEvidence: [],
      },
    },
  },
} as unknown as DocumentControllerState

const controllerReport = controller.report
if (!controllerReport?.rebuild.ok) {
  throw new Error("The model-tree fixture requires a successful rebuild report.")
}
const suppressedFeature = featureRecordSchema.parse({ ...feature, suppressed: true })
const suppressedController = {
  ...controller,
  report: {
    ...controllerReport,
    snapshot: { ...controllerReport.snapshot, features: [suppressedFeature] },
    rebuild: {
      ok: true,
      response: {
        ...controllerReport.rebuild.response,
        evaluation: {
          records: [{ featureId, status: "suppressed" }],
          dirtyFeatureIds: [],
          evaluatedFeatureIds: [featureId],
          reusedFeatureIds: [],
        },
        geometry: [],
      },
    },
  },
} as unknown as DocumentControllerState

function controllerWithBrokenSketchReference() {
  const source = createEmptySketch({
    id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2801"),
    label: "Source",
    plane: "xy",
  })
  const target = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2802",
    label: "Dependent",
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f2803",
        sourceSketchId: source.id,
        sourcePointId: sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2804"),
        projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f2805",
      },
    ],
  })
  return {
    target,
    controller: {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [feature], revision: 8, sketches: [source, target] },
      },
    } as unknown as DocumentControllerState,
  }
}

function controllerWithBrokenModelReference() {
  const target = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2810",
    label: "Model dependent",
    plane: "xy",
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f2811",
        kind: "model-point",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "vertex",
          signature: {
            kind: "vertex",
            geometryClass: "POINT",
            measure: 0,
            centroid: [0, 0, 0],
            bounds: { min: [0, 0, 0], max: [0, 0, 0] },
            boundaryCount: 0,
            adjacentGeometryClasses: [],
          },
        },
        projectedPointId: "0195b5ac-b220-7a2c-8c33-67a36a7f2812",
      },
    ],
  })
  return {
    target,
    controller: {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [feature], revision: 8, sketches: [target] },
        rebuild: {
          ok: true,
          response: {
            modelReferenceEvidence: [
              {
                sketchId: target.id,
                referenceId: target.externalReferences?.[0]?.id,
                status: "broken",
              },
            ],
          },
        },
      },
    } as unknown as DocumentControllerState,
  }
}

function controllerWithMissingSketchSupport(ownerStatus: "succeeded" | "failed" = "succeeded") {
  const target = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f2820",
    label: "Face sketch",
    plane: "xy",
    support: {
      kind: "feature-face",
      reference: {
        schemaVersion: 0,
        featureId,
        kind: "face",
        semanticRole: "primitive.box.cap.end",
        signature: {
          kind: "face",
          geometryClass: "PLANE",
          measure: 400,
          centroid: [0, 0, 20],
          bounds: { min: [-10, -10, 20], max: [10, 10, 20] },
          direction: [0, 0, 1],
          directionMode: "oriented",
          boundaryCount: 4,
          adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
        },
        intent: { nearPoint: [0, 0, 20], expectedDirection: [0, 0, 1] },
      },
    },
    entities: [],
    constraints: [],
  })
  return {
    target,
    controller: {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [feature], revision: 8, sketches: [target] },
        rebuild: {
          ok: true,
          response: {
            evaluation: {
              records: [
                ownerStatus === "succeeded"
                  ? { featureId, status: ownerStatus, contentHash: "a".repeat(64) }
                  : {
                      featureId,
                      status: ownerStatus,
                      diagnostics: [{ code: "test.failure", values: {} }],
                    },
              ],
            },
            geometry: [
              {
                featureId,
                geometry: { topologyCandidates: [] },
              },
            ],
            modelReferenceEvidence: [],
          },
        },
      },
    } as unknown as DocumentControllerState,
  }
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock))
afterAll(() => vi.unstubAllGlobals())
afterEach(cleanup)

type ModelTreeProps = ComponentProps<typeof ModelTree>
type RenderTreeOptions = Partial<
  Pick<
    ModelTreeProps,
    | "activeSketchId"
    | "activeFeatureId"
    | "activeWorkspace"
    | "controller"
    | "onFeatureActivate"
    | "onFeatureRename"
    | "onFeatureRemove"
    | "onFeatureDeleted"
    | "onFeaturePreselectionChange"
    | "onFeatureSuppressionChange"
    | "onFeatureVisibilityChange"
    | "onHistoryMove"
    | "onSketchActivate"
    | "onSketchSupportRepair"
    | "onAllSketchVisibilityToggle"
    | "onSketchDeleted"
    | "onSketchRemove"
    | "onSketchRename"
    | "onSketchVisibilityChange"
    | "onWorkspaceChange"
    | "sketchRenameBlockedId"
    | "hiddenFeatureIds"
    | "hiddenSketchIds"
    | "onSourceProfilePreview"
    | "sourcePreviewSketchId"
    | "onPartSelect"
    | "selectedPartId"
    | "onAuthoredMetadata"
    | "onBodyPreselectionChange"
    | "onBodyActivate"
    | "onRevealFeature"
    | "revealRequest"
  >
>

function authoredInsertionController() {
  const base = authoredTreeFixture().authority
  const sourceId = requireAuthoredFixture(base.features[0]).id
  const transformerId = featureIdSchema.parse(authoredTestId(910))
  const envelope = {
    schemaVersion: 2,
    commandId: authoredTestId(900),
    documentId: base.id,
    baseRevision: base.revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
  const inserted = applyDocumentV2Command(base, {
    ...envelope,
    kind: "org.vibeshape.document.model-command",
    payload: {
      command: {
        ...envelope,
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-feature",
        payload: {
          historyAfter: base.history[0],
          feature: {
            schemaVersion: 0,
            id: transformerId,
            type: filletFeatureType.type,
            parameters: { radius: createLengthQuantity(2) },
            dependencies: [sourceId],
            references: [],
            suppressed: false,
            label: "Later fillet",
          },
        },
      },
      partAllocations: [],
    },
  })
  if (!inserted.ok) throw new Error(JSON.stringify(inserted.diagnostic))
  const authority = inserted.snapshot
  const part = requireAuthoredFixture(authority.parts[0])
  const sample = authoredTestBody(part)
  const projected = projectDocumentSnapshotV1ToV0(projectDocumentSnapshotV2ToV1(authority))
  if (!projected.ok) throw new Error(JSON.stringify(projected.diagnostic))
  const response = documentWorkerResponseSchema.parse({
    type: "documentRebuilt",
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: "history-parts-test",
    documentId: authority.id,
    revision: authority.revision,
    generation: 1,
    evaluation: {
      records: authority.features.map(({ id }) => ({
        featureId: id,
        status: "succeeded",
        contentHash: sample.contentHash,
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: authority.features.map(({ id }) => id),
      reusedFeatureIds: [],
    },
    geometry: authority.features.map(({ id }) => ({
      featureId: id,
      contentHash: sample.contentHash,
      meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
      geometry: {
        engine: {
          adapter: "replicad",
          adapterVersion: "test",
          replicadVersion: "0.23.1",
          opencascadePackageVersion: "0.23.0",
          opencascadeSourceRevision: null,
          wasmBytes: 1,
          initializedInMs: 1,
          featureContentEnvironment: {
            schemaVersion: 0,
            hostApiVersion: "0.1.0",
            geometry: {
              adapterId: "org.vibeshape.geometry.replicad",
              adapterVersion: "test",
              kernelId: "org.opencascade.occt",
              kernelVersion: "0.23.0",
              kernelSourceRevision: null,
            },
            modelingTolerancePolicyVersion: 1,
            provider: { kind: "built-in" },
          },
        },
        shape: sample.shape,
        mesh: sample.mesh,
        topologyCandidates: [],
        cache: { brepHit: false },
        timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
      },
    })),
    sketches: [],
    modelReferenceEvidence: [],
  })
  if (response.type !== "documentRebuilt") throw new Error("The fixture requires rebuild evidence.")
  const report: NonNullable<DocumentControllerState["report"]> = {
    status: "created",
    mode: "read-write",
    snapshot: projected.snapshot,
    historyItems: authority.history,
    rebuild: { ok: true, response },
    lostRevisionCount: 0,
    corruptRecords: [],
    migration: null,
    writeAccessDiagnostic: null,
  }
  const controller: DocumentControllerState = {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report,
    authoredSnapshot: authority,
    historyInsertion: {
      documentId: authority.id,
      baseRevision: authority.revision,
      historyAfter: requireAuthoredFixture(authority.history[0]),
    },
  }
  return { controller, sourceId, transformerId, part }
}

function renderTree(options: RenderTreeOptions = {}, detailed = true) {
  const props: ModelTreeProps = {
    activeFeatureId: featureId,
    activeSketchId: null,
    activeWorkspace: "model",
    controller,
    hiddenFeatureIds: [],
    hiddenSketchIds: [],
    onFeatureActivate: vi.fn(),
    onFeatureRename: vi.fn().mockResolvedValue({ ok: true }),
    onFeatureRemove: vi.fn().mockResolvedValue({ ok: true }),
    onFeatureDeleted: vi.fn(),
    onFeaturePreselectionChange: vi.fn(),
    onFeatureSuppressionChange: vi.fn().mockResolvedValue({ ok: true }),
    onFeatureVisibilityChange: vi.fn(),
    onHistoryMove: vi.fn().mockResolvedValue({ ok: true }),
    onSketchActivate: vi.fn(),
    onSketchSupportRepair: vi.fn(),
    onAllSketchVisibilityToggle: vi.fn(),
    onSketchDeleted: vi.fn(),
    onSketchRemove: vi.fn().mockResolvedValue({ ok: true }),
    onSketchRename: vi.fn().mockResolvedValue({ ok: true }),
    onSketchVisibilityChange: vi.fn(),
    onWorkspaceChange: vi.fn(),
    sketchRenameBlockedId: null,
    ...options,
  }
  const content = (props: ModelTreeProps) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <ModelTree {...props} />
        <ModelTree {...props} surface="timeline" />
      </TooltipProvider>
    </I18nProvider>
  )
  const result = render(content(props))
  if (detailed) fireEvent.click(screen.getByRole("button", { name: "Details" }))
  return {
    ...result,
    rerenderTree: (options: RenderTreeOptions) =>
      result.rerender(content({ ...props, ...options })),
  }
}

function browser() {
  return within(screen.getByRole("complementary", { name: "Model tree" }))
}

function timeline() {
  return within(screen.getByRole("region", { name: "Feature history" }))
}

describe("ModelTree insertion body boundary", () => {
  it("keeps full History while disabling later Parts and resolving an upstream body before its transformer", async () => {
    const { controller, sourceId, part } = authoredInsertionController()
    const onPartSelect = vi.fn()
    const onBodyPreselectionChange = vi.fn()
    renderTree({
      controller,
      activeFeatureId: null,
      onPartSelect,
      onBodyPreselectionChange,
      onAuthoredMetadata: vi.fn().mockResolvedValue({ ok: true }),
    })
    expect(screen.getByRole("treeitem", { name: "Box 3" })).toBeTruthy()
    expect(screen.getByRole("treeitem", { name: "Later fillet" })).toBeTruthy()
    for (const name of ["Part Part 2", "Part Part 3"]) {
      const later = screen.getByRole("treeitem", { name }) as HTMLButtonElement
      expect(later.disabled).toBe(true)
      expect(later.closest("[data-part-status]")?.getAttribute("data-part-status")).toBe(
        "unavailable",
      )
      await userEvent.click(later)
    }
    expect(onPartSelect).not.toHaveBeenCalled()
    const current = screen.getByRole("treeitem", { name: "Part Part 1" }) as HTMLButtonElement
    expect(current.disabled).toBe(false)
    expect(screen.getByText("Earlier result at the insertion point.")).toBeTruthy()
    await userEvent.hover(current)
    expect(onBodyPreselectionChange).toHaveBeenLastCalledWith({ featureId: sourceId })
    await userEvent.click(current)
    expect(onPartSelect).toHaveBeenCalledTimes(1)
    expect(onPartSelect).toHaveBeenCalledWith(part.id)
  })

  it("scopes unmanaged body rows to the insertion prefix while retaining later History", async () => {
    const { controller, sourceId } = authoredInsertionController()
    const onFeatureActivate = vi.fn()
    renderTree({
      controller: { ...controller, authoredSnapshot: null },
      activeFeatureId: null,
      onFeatureActivate,
    })
    expect(screen.getByRole("treeitem", { name: "Box 3" })).toBeTruthy()
    expect(screen.queryByRole("treeitem", { name: "Body 2" })).toBeNull()
    await userEvent.click(screen.getByRole("treeitem", { name: "Body 1" }))
    expect(onFeatureActivate).toHaveBeenCalledTimes(1)
    expect(onFeatureActivate).toHaveBeenCalledWith(sourceId)
  })
})

describe("ModelTree History presentation", () => {
  it.each([false, true])(
    "distinguishes missing sources from unnamed existing sketches (%s)",
    async (exists) => {
      const onPreview = vi.fn()
      const onOpen = vi.fn()
      render(
        <I18nProvider i18n={i18n} initialLocale="en">
          <TooltipProvider>
            <HistoryProfileSources
              profiles={[
                {
                  schemaVersion: 0,
                  sketchId,
                  outerBoundaryEntityIds: [
                    sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2901"),
                  ],
                  holeBoundaryEntityIds: [],
                },
              ]}
              labelsByRef={new Map(exists ? [[`sketch:${sketchId}`, ""]] : [])}
              dependencyDescription="Depends on 1 item."
              onPreview={onPreview}
              onOpen={onOpen}
            />
          </TooltipProvider>
        </I18nProvider>,
      )
      if (exists) {
        expect(
          screen.getByRole("button", { name: "Source region 1 from Unnamed sketch" }),
        ).toBeTruthy()
        await userEvent.click(
          screen.getByRole("button", { name: "Source region 1 from Unnamed sketch" }),
        )
        expect(onOpen).toHaveBeenCalledWith(sketchId)
      } else {
        const missing = screen.getByText("Missing sketch")
        await userEvent.setup().hover(missing)
        expect(screen.queryByRole("button")).toBeNull()
        expect(onPreview).not.toHaveBeenCalled()
        expect(screen.getByText(/The source sketch is unavailable/)).toBeTruthy()
      }
    },
  )
  it.each(["legacy", "multi"] as const)(
    "shows compact %s profile sources and opens its source sketch through the ordinary History action",
    async (kind) => {
      const user = userEvent.setup()
      const onPreview = vi.fn()
      const onSketchActivate = vi.fn()
      const profile = {
        schemaVersion: 0 as const,
        sketchId,
        outerBoundaryEntityIds: [
          sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2901"),
        ],
        holeBoundaryEntityIds: [],
      }
      const secondProfile = {
        ...profile,
        outerBoundaryEntityIds: [
          sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2902"),
        ],
      }
      const extrusion = featureRecordSchema.parse({
        ...feature,
        type:
          kind === "legacy"
            ? legacyExtrusionFeatureType.type
            : multiProfileExtrusionFeatureType.type,
        parameters: {
          ...(kind === "legacy"
            ? { profile }
            : { profiles: createSketchProfileSet([profile, secondProfile]) }),
          distance: createLengthQuantity(10, "mm", "10 mm"),
          symmetric: false,
          operation: "new",
        },
      })
      const source = {
        ...controller,
        report: {
          ...controllerReport,
          snapshot: { ...controllerReport.snapshot, features: [extrusion] },
        },
      } as DocumentControllerState
      renderTree({
        controller: source,
        onSourceProfilePreview: onPreview,
        onSketchActivate,
        sourcePreviewSketchId: sketchId,
      })
      const link = screen.getByRole("button", { name: "Source region 1 from Profile" })
      expect(link.textContent).toBe(kind === "legacy" ? "Profile" : "Profile1")
      await user.hover(link)
      expect(onPreview).toHaveBeenLastCalledWith(profile)
      await user.unhover(link)
      expect(onPreview).toHaveBeenLastCalledWith(null)
      if (kind === "multi") {
        await user.hover(screen.getByRole("button", { name: "Source region 2 from Profile" }))
        expect(onPreview).toHaveBeenLastCalledWith(secondProfile)
      }
      const sketchRow = timeline().getByRole("treeitem", { name: "Edit Profile" })
      expect(
        sketchRow.closest("[data-history-id]")?.getAttribute("data-history-source-highlighted"),
      ).toBe("true")
      const scroll = vi.fn()
      sketchRow.scrollIntoView = scroll
      await user.click(link)
      expect(scroll).toHaveBeenCalledWith({ block: "nearest" })
      expect(document.activeElement).toBe(sketchRow)
      expect(onSketchActivate).toHaveBeenCalledWith(sketchId)
      expect(onPreview).toHaveBeenLastCalledWith(null)
    },
  )
  it("excludes compact source controls from accessible roles and tab navigation until Details opens", async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const profile = {
      schemaVersion: 0 as const,
      sketchId,
      outerBoundaryEntityIds: [sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2901")],
      holeBoundaryEntityIds: [],
    }
    const extrusion = featureRecordSchema.parse({
      ...feature,
      type: legacyExtrusionFeatureType.type,
      parameters: {
        profile,
        distance: createLengthQuantity(10),
        symmetric: false,
        operation: "new",
      },
    })
    renderTree(
      {
        controller: {
          ...controller,
          report: {
            ...controllerReport,
            snapshot: { ...controllerReport.snapshot, features: [extrusion] },
          },
        },
        onSourceProfilePreview: onPreview,
      },
      false,
    )
    const sourceName = "Source region 1 from Profile"
    const actions = timeline().getByRole("button", { name: "Actions for Box 1" })
    expect(timeline().queryByRole("button", { name: sourceName }) === null).toBe(true)
    act(() => actions.focus())
    await user.tab()
    expect(document.activeElement?.getAttribute("aria-label")).not.toBe(sourceName)
    expect(onPreview).not.toHaveBeenCalled()

    await user.click(timeline().getByRole("button", { name: "Details" }))
    const source = timeline().getByRole("button", { name: sourceName })
    act(() => actions.focus())
    await user.tab()
    expect(document.activeElement === source).toBe(true)
    expect(onPreview).toHaveBeenLastCalledWith(profile)
  })

  it("captures a sortable source at drag start before a drop target exists", async () => {
    const onHistoryMove = vi.fn().mockResolvedValue({ ok: true })
    const semanticController = {
      ...controller,
      report: {
        ...controllerReport,
        historyItems: [
          { kind: "sketch" as const, id: sketchId },
          { kind: "feature" as const, id: featureId },
        ],
      },
    } as unknown as DocumentControllerState
    renderTree({ activeFeatureId: null, controller: semanticController, onHistoryMove })
    const callbacks = sortableCallbacks.current as TestDragCallbacks
    const source = { id: `feature:${featureId}`, index: 1, initialIndex: 1 }
    const target = { id: `sketch:${sketchId}`, index: 0, initialIndex: 0 }

    act(() => callbacks.onDragStart({ operation: { source, target: null } }))
    act(() => callbacks.onDragOver({ operation: { source, target } }))
    act(() => callbacks.onDragEnd({ operation: { source, target }, canceled: false }))

    await waitFor(() => {
      expect(onHistoryMove).toHaveBeenCalledWith(7, { kind: "feature", id: featureId }, null)
    })
    expect(screen.getByText("Moved Box 1 to position 1")).toBeTruthy()
  })

  it("locks dragging while a move is pending and releases it after rejection", async () => {
    let rejectPending: ((error: Error) => void) | undefined
    const onHistoryMove = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectPending = reject
          }),
      )
      .mockResolvedValue({ ok: true })
    const semanticController = {
      ...controller,
      report: {
        ...controllerReport,
        historyItems: [
          { kind: "sketch" as const, id: sketchId },
          { kind: "feature" as const, id: featureId },
        ],
      },
    } as unknown as DocumentControllerState
    const { container } = renderTree({
      activeFeatureId: null,
      controller: semanticController,
      onHistoryMove,
    })

    dragHistoryRow(`feature:${featureId}`, 1, `sketch:${sketchId}`, 0)
    await waitFor(() => {
      expect(
        timeline()
          .getByRole("treeitem", { name: "Edit Profile" })
          .closest("[data-history-id]")
          ?.getAttribute("data-history-reorder-disabled"),
      ).toBe("true")
    })
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-history-id]")].map(
        (element) => element.dataset.historyId,
      ),
    ).toEqual([sketchId, featureId])

    await act(async () => {
      rejectPending?.(new Error("Move rejected"))
    })
    await waitFor(() => {
      expect(
        timeline()
          .getByRole("treeitem", { name: "Edit Profile" })
          .closest("[data-history-id]")
          ?.getAttribute("data-history-reorder-disabled"),
      ).toBeNull()
    })
    expect(screen.getByText("History reorder cancelled")).toBeTruthy()

    dragHistoryRow(`feature:${featureId}`, 1, `sketch:${sketchId}`, 0)
    await waitFor(() => expect(onHistoryMove).toHaveBeenCalledTimes(2))
    expect(screen.getByText("Moved Box 1 to position 1")).toBeTruthy()
  })

  it("uses semantic History order and moves independent rows by stable identity without a position picker", async () => {
    const onHistoryMove = vi.fn().mockResolvedValue({ ok: true })
    const semanticController = {
      ...controller,
      report: {
        ...controllerReport,
        historyItems: [
          { kind: "sketch" as const, id: sketchId },
          { kind: "feature" as const, id: featureId },
        ],
      },
    } as unknown as DocumentControllerState
    const { container } = renderTree({
      activeFeatureId: null,
      controller: semanticController,
      onHistoryMove,
    })

    expect(
      [...container.querySelectorAll<HTMLElement>("[data-history-id]")].map(
        (element) => element.dataset.historyId,
      ),
    ).toEqual([sketchId, featureId])
    expect(screen.queryByRole("button", { name: "Reorder Profile" })).toBeNull()
    expect(
      timeline().getByRole("treeitem", { name: "Edit Profile" }).getAttribute("aria-describedby"),
    ).toBe("history-drag-instructions")
    expect(screen.queryByRole("button", { name: "Move Profile earlier" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Move Profile" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Move Box 1" })).toBeNull()

    dragHistoryRow(`feature:${featureId}`, 1, `sketch:${sketchId}`, 0)
    expect(onHistoryMove).toHaveBeenCalledWith(7, { kind: "feature", id: featureId }, null)
  })

  it("blocks drag destinations across a declared dependency", () => {
    const fixture = controllerWithBrokenSketchReference()
    const report = fixture.controller.report
    if (!report) throw new Error("Expected a controller report.")
    const [source, target] = report.snapshot.sketches
    if (!source || !target) throw new Error("Expected source and target sketches.")
    const dependencyController = {
      ...fixture.controller,
      report: {
        ...report,
        historyItems: [
          { kind: "sketch" as const, id: source.id },
          { kind: "sketch" as const, id: target.id },
          { kind: "feature" as const, id: featureId },
        ],
      },
    } as unknown as DocumentControllerState

    const onHistoryMove = vi.fn()
    renderTree({ activeFeatureId: null, controller: dependencyController, onHistoryMove })
    dragHistoryRow(`sketch:${source.id}`, 0, `sketch:${target.id}`, 1)
    expect(onHistoryMove).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        "Cannot move Source to this position because it would break a History dependency",
      ),
    ).toBeTruthy()
  })

  it("separates graph-ordered History from browser workspaces, bodies, and sketches", () => {
    const { container } = renderTree()

    expect(timeline().getByRole("treeitem", { name: "History" })).toBeTruthy()
    expect(browser().queryByRole("treeitem", { name: "History" })).toBeNull()
    for (const name of ["Variables", "Bodies", "Sketches", "Body 1", "Profile"]) {
      expect(browser().getByRole("treeitem", { name })).toBeTruthy()
      expect(timeline().queryByRole("treeitem", { name })).toBeNull()
    }
    expect(browser().queryByRole("treeitem", { name: "Box 1" })).toBeNull()
    expect(timeline().getByRole("treeitem", { name: "Edit Profile" })).toBeTruthy()
    expect(screen.queryByRole("treeitem", { name: "Features" })).toBeNull()
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-history-id]")].map(
        (element) => `${element.dataset.historyKind}:${element.dataset.historyId}`,
      ),
    ).toEqual([`feature:${featureId}`, `sketch:${sketchId}`])
    expect(screen.getByRole("treeitem", { name: "Body 1" })).toBeTruthy()
    expect(screen.getByText("Result of Box 1")).toBeTruthy()
    expect(screen.getByRole("treeitem", { name: "Box 1" }).querySelector("svg")).toBeTruthy()
    expect(timeline().getByText("Supported by XY plane")).toBeTruthy()
  })

  it("shows a transient rollback boundary only during active sketch editing", () => {
    const downstreamSketch = createEmptySketch({
      id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2604"),
      label: "Downstream profile",
      plane: "xz",
    })
    const editController = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [feature], revision: 7, sketches: [sketch, downstreamSketch] },
      },
    } as unknown as DocumentControllerState
    const first = renderTree({
      activeSketchId: sketchId,
      activeWorkspace: "sketch",
      controller: editController,
    })

    expect(screen.getByText(/Edit point in History/)).toBeTruthy()
    expect(
      first.container
        .querySelector(`[data-history-id="${downstreamSketch.id}"]`)
        ?.getAttribute("data-history-rolled-back"),
    ).toBe("true")

    first.unmount()
    const normal = renderTree({ controller: editController })
    expect(screen.queryByText(/Edit point in History/)).toBeNull()
    expect(normal.container.querySelector("[data-history-rolled-back='true']")).toBeNull()
  })

  it("omits rollback guidance when the edited sketch is already the last History item", () => {
    renderTree({
      activeSketchId: sketchId,
      activeWorkspace: "sketch",
    })

    expect(screen.queryByText(/Edit point in History/)).toBeNull()
    expect(document.querySelector("[data-history-rolled-back='true']")).toBeNull()
  })

  it("keeps datum geometry in History and out of Bodies", () => {
    const datumController = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [feature, datumFeature], revision: 7, sketches: [sketch] },
      },
    } as unknown as DocumentControllerState
    const { container } = renderTree({ controller: datumController })

    expect(
      container
        .querySelector(`[data-history-id="${datumFeature.id}"]`)
        ?.getAttribute("data-history-feature-kind"),
    ).toBe("datum")
    expect(screen.getByRole("treeitem", { name: "Offset plane" }).querySelector("svg")).toBeTruthy()
    expect(screen.queryByText("Result of Offset plane")).toBeNull()
    expect(screen.getByText("Supported by XZ plane")).toBeTruthy()
  })
})

describe("ModelTree History disclosure", () => {
  it("keeps browser sketches, bodies, and History disclosure independent during sketch editing", async () => {
    const user = userEvent.setup()
    const onWorkspaceChange = vi.fn()
    const onSketchActivate = vi.fn()
    renderTree({
      activeSketchId: sketchId,
      activeWorkspace: "sketch",
      onWorkspaceChange,
      onSketchActivate,
    })

    const history = timeline().getByRole("treeitem", { name: "History" })
    await user.click(history)
    expect(history.getAttribute("aria-expanded")).toBe("false")
    expect(timeline().queryByRole("treeitem", { name: "Edit Profile" })).toBeNull()
    expect(browser().getByRole("treeitem", { name: "Profile" })).toBeTruthy()

    await user.click(history)
    const sketches = browser().getByRole("treeitem", { name: "Sketches" })
    await user.click(sketches)
    expect(sketches.getAttribute("aria-expanded")).toBe("false")
    expect(browser().queryByRole("treeitem", { name: "Profile" })).toBeNull()
    expect(timeline().getByRole("treeitem", { name: "Edit Profile" })).toBeTruthy()

    const bodies = browser().getByRole("treeitem", { name: "Bodies" })
    await user.click(bodies)
    expect(bodies.getAttribute("aria-expanded")).toBe("false")
    expect(browser().queryByRole("treeitem", { name: "Body 1" })).toBeNull()
    expect(history.getAttribute("aria-expanded")).toBe("true")
    expect(onWorkspaceChange).not.toHaveBeenCalled()
    expect(onSketchActivate).not.toHaveBeenCalled()
  })

  it("navigates browser disclosure with vertical arrows without entering the timeline", async () => {
    const user = userEvent.setup()
    renderTree()

    const sketches = browser().getByRole("treeitem", { name: "Sketches" })
    sketches.focus()
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(browser().getByRole("treeitem", { name: "Profile" }))
    await user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(document.activeElement).toBe(sketches)
    expect(sketches.getAttribute("aria-expanded")).toBe("false")
    await user.keyboard("{Home}")
    expect(document.activeElement).toBe(browser().getByRole("treeitem", { name: "Variables" }))
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(browser().getByRole("treeitem", { name: "Origin" }))
  })

  it("navigates horizontal History with left and right arrows and keeps its tab stop scoped", async () => {
    const user = userEvent.setup()
    renderTree({}, false)
    const history = timeline().getByRole("treeitem", { name: "History" })
    const featureItem = timeline().getByRole("treeitem", { name: "Box 1" })
    const sketchItem = timeline().getByRole("treeitem", { name: "Edit Profile" })
    expect(timeline().getByRole("tree").getAttribute("aria-orientation")).toBe("horizontal")
    history.focus()
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(featureItem)
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(sketchItem)
    expect(sketchItem.tabIndex).toBe(0)
    expect(featureItem.tabIndex).toBe(-1)
    await user.keyboard("{ArrowLeft}")
    expect(document.activeElement).toBe(featureItem)
    await user.keyboard("{End}")
    expect(document.activeElement).toBe(sketchItem)
    await user.keyboard("{Home}")
    expect(document.activeElement).toBe(history)
    expect(browser().getByRole("treeitem", { name: "Variables" }).tabIndex).toBe(0)
  })

  it("starts with compact History icons and toggles details without changing browser content", async () => {
    const user = userEvent.setup()
    renderTree({}, false)
    const details = timeline().getByRole("button", { name: "Details" })
    const featureItem = timeline().getByRole("treeitem", { name: "Box 1" })
    expect(within(featureItem).getByText("Box 1").classList.contains("sr-only")).toBe(true)
    expect(featureItem.querySelector("svg")).toBeTruthy()
    expect(featureItem.getAttribute("data-size")).toBe("icon-sm")
    expect(featureItem.classList.contains("flex-none")).toBe(true)
    const compactSketch = timeline().getByRole("treeitem", { name: "Edit Profile" })
    expect(compactSketch.getAttribute("data-size")).toBe("icon-sm")
    expect(compactSketch.classList.contains("flex-none")).toBe(true)
    expect(compactSketch.querySelector("svg")?.classList.contains("mr-1")).toBe(false)
    expect(timeline().queryByRole("button", { name: "Hide Box 1" })).toBeNull()
    expect(browser().getByRole("button", { name: "Hide Profile" })).toBeTruthy()
    await user.click(details)
    expect(within(featureItem).getByText("Box 1").classList.contains("sr-only")).toBe(false)
    expect(timeline().getByRole("button", { name: "Hide Box 1" })).toBeTruthy()
    expect(timeline().getByText("Supported by XY plane")).toBeTruthy()
    await user.click(details)
    expect(within(featureItem).getByText("Box 1").classList.contains("sr-only")).toBe(true)
    expect(timeline().queryByRole("button", { name: "Hide Box 1" })).toBeNull()
    expect(browser().getByRole("treeitem", { name: "Profile" })).toBeTruthy()
  })
})

describe("ModelTree compact repair evidence", () => {
  it.each(["reference", "support"] as const)(
    "keeps a visible repair badge on compact sketches with a broken %s",
    async (kind) => {
      const broken =
        kind === "reference"
          ? controllerWithBrokenSketchReference()
          : controllerWithMissingSketchSupport()
      renderTree({ controller: broken.controller }, false)
      const sketchItem = timeline().getByRole("treeitem", { name: `Edit ${broken.target.label}` })
      const row = sketchItem.closest<HTMLElement>("[data-history-id]")
      if (!row) throw new Error("Expected the compact History row.")
      const diagnostic =
        kind === "reference"
          ? "Needs repair: 1 direct failure; no chained failures."
          : "Needs repair: the support face is missing."
      expect(within(row).getByRole("img", { name: diagnostic })).toBeTruthy()
      expect(within(sketchItem).getByText(broken.target.label).classList.contains("sr-only")).toBe(
        true,
      )
      expect(timeline().getAllByRole("img")).toHaveLength(1)
      expect(sketchItem.getAttribute("data-size")).toBe("icon-sm")
      expect(sketchItem.classList.contains("flex-none")).toBe(true)
      const repairName =
        kind === "reference"
          ? "Open Dependent to repair 1 broken reference"
          : "Replace the missing support for Face sketch"
      expect(within(row).queryByRole("button", { name: repairName })).toBeNull()
      expect(within(row).getByRole("img").classList.contains("bottom-1")).toBe(true)
      const browserRepair = browser().getByRole("button", { name: repairName })
      expect(browserRepair).toBeTruthy()
      await userEvent.hover(sketchItem)
      expect((await screen.findByRole("tooltip")).textContent).toBe(diagnostic)
    },
  )
})

describe("ModelTree workspace readiness", () => {
  it("keeps workspace activation locked while the document session is loading", async () => {
    const user = userEvent.setup()
    const onWorkspaceChange = vi.fn()
    const loadingController = { ...controller, status: "loading" } as DocumentControllerState

    renderTree({ controller: loadingController, onWorkspaceChange })

    const variables = screen.getByRole("treeitem", { name: "Variables" })
    expect((variables as HTMLButtonElement).disabled).toBe(true)
    await user.click(variables)
    expect(onWorkspaceChange).not.toHaveBeenCalled()
  })

  it("keeps workspace activation available for a ready read-only document", async () => {
    const user = userEvent.setup()
    const onWorkspaceChange = vi.fn()
    const readOnlyController = {
      ...controller,
      report: { ...controller.report, mode: "read-only" },
    } as unknown as DocumentControllerState

    renderTree({ controller: readOnlyController, onWorkspaceChange })
    await user.click(screen.getByRole("treeitem", { name: "Variables" }))
    expect(onWorkspaceChange).toHaveBeenCalledWith("variables")
  })
})

describe("ModelTree History failure", () => {
  it("exposes a bounded status instead of a rollback claim when graph ordering fails", () => {
    const invalidFeature = { ...feature, dependencies: [feature.id] }
    const invalidController = {
      ...controller,
      report: {
        ...controller.report,
        snapshot: { features: [invalidFeature], revision: 7, sketches: [sketch] },
      },
    } as unknown as DocumentControllerState
    const { container } = renderTree({
      activeSketchId: sketchId,
      activeWorkspace: "sketch",
      controller: invalidController,
    })

    expect(screen.getByText(/History ordering is unavailable/).getAttribute("role")).toBe("status")
    expect(screen.queryByText(/Rollback context/)).toBeNull()
    expect(container.querySelector("[data-history-rolled-back='true']")).toBeNull()
  })
})

describe("ModelTree folder selection descriptions", () => {
  it("announces feature and sketch grouping selection without changing edit selection or browser names", async () => {
    const user = userEvent.setup()
    const fixture = authoredInsertionController()
    const authority = fixture.controller.authoredSnapshot
    const report = fixture.controller.report
    if (!authority || authority.schemaVersion === 1 || !report)
      throw new Error("Expected authored History.")
    const history = [...authority.history, { kind: "sketch" as const, id: sketchId }]
    const activeFeature = requireAuthoredFixture(
      authority.features.find(({ label }) => label === "Box 2"),
    )
    const onFeatureActivate = vi.fn()
    const onSketchActivate = vi.fn()
    renderTree(
      {
        controller: {
          ...fixture.controller,
          historyInsertion: null,
          authoredSnapshot: { ...authority, sketches: [...authority.sketches, sketch], history },
          report: {
            ...report,
            historyItems: history,
            snapshot: { ...report.snapshot, sketches: [...report.snapshot.sketches, sketch] },
          },
        },
        activeFeatureId: activeFeature.id,
        onFeatureActivate,
        onSketchActivate,
        onAuthoredMetadata: vi.fn().mockResolvedValue({ ok: true }),
      },
      false,
    )
    const featureItem = timeline().getByRole("treeitem", { name: "Box 2" })
    const sketchItem = timeline().getByRole("treeitem", { name: "Edit Profile" })
    const browserSketch = browser().getByRole("treeitem", { name: "Profile" })
    expect(
      timeline().getByRole("treeitem", {
        name: "Box 2",
        description: /Not selected for folder grouping[.]/,
      }),
    ).toBe(featureItem)
    expect(
      timeline().getByRole("treeitem", {
        name: "Edit Profile",
        description: /Not selected for folder grouping[.]/,
      }),
    ).toBe(sketchItem)
    expect(browserSketch.getAttribute("aria-describedby")).toBeNull()
    act(() => featureItem.focus())
    await user.keyboard("{Shift>} {/Shift}")
    expect(
      timeline().getByRole("treeitem", {
        name: "Box 2",
        description: /Selected for folder grouping[.]/,
      }),
    ).toBe(featureItem)
    expect(featureItem.getAttribute("aria-selected")).toBe("true")
    fireEvent.click(sketchItem, { ctrlKey: true })
    expect(
      timeline().getByRole("treeitem", {
        name: "Edit Profile",
        description: /Selected for folder grouping[.]/,
      }),
    ).toBe(sketchItem)
    expect(sketchItem.getAttribute("aria-selected")).toBe("false")
    fireEvent.click(featureItem, { ctrlKey: true })
    expect(
      timeline().getByRole("treeitem", {
        name: "Box 2",
        description: /Not selected for folder grouping[.]/,
      }),
    ).toBe(featureItem)
    expect(featureItem.getAttribute("aria-selected")).toBe("true")
    expect(
      browser().getByRole("treeitem", { name: "Profile" }).getAttribute("aria-describedby"),
    ).toBeNull()
    expect(timeline().getByRole("treeitem", { name: "Edit Profile" })).toBe(sketchItem)
    expect(onFeatureActivate).not.toHaveBeenCalled()
    expect(onSketchActivate).not.toHaveBeenCalled()
  })
})

describe("ModelTree selection", () => {
  it("exposes the active feature and activates it by stable feature identity", async () => {
    const user = userEvent.setup()
    const onFeatureActivate = vi.fn()

    renderTree({ onFeatureActivate })

    const featureItem = screen.getByRole("treeitem", { name: "Box 1" })
    expect(featureItem.getAttribute("aria-selected")).toBe("true")
    await user.click(featureItem)
    expect(onFeatureActivate).toHaveBeenCalledWith(featureId)
  })

  it("preselects feature geometry from pointer hover and keyboard focus", async () => {
    const user = userEvent.setup()
    const onFeaturePreselectionChange = vi.fn()
    renderTree({ onFeaturePreselectionChange })
    const featureItem = screen.getByRole("treeitem", { name: "Box 1" })

    await user.hover(featureItem)
    expect(onFeaturePreselectionChange).toHaveBeenLastCalledWith(featureId)
    await user.unhover(featureItem)
    expect(onFeaturePreselectionChange).toHaveBeenLastCalledWith(null)

    featureItem.focus()
    expect(onFeaturePreselectionChange).toHaveBeenLastCalledWith(featureId)
    featureItem.blur()
    expect(onFeaturePreselectionChange).toHaveBeenLastCalledWith(null)
  })

  it("enters the existing sketch editor from the model-tree sketch item", async () => {
    const user = userEvent.setup()
    const onSketchActivate = vi.fn()

    renderTree({ onSketchActivate })

    await user.click(screen.getByRole("treeitem", { name: "Profile" }))

    expect(onSketchActivate).toHaveBeenCalledWith(sketchId)
  })

  it("surfaces broken sketch references and opens the affected sketch for repair", async () => {
    const user = userEvent.setup()
    const onSketchActivate = vi.fn()
    const broken = controllerWithBrokenSketchReference()

    renderTree({ controller: broken.controller, onSketchActivate })

    expect(
      timeline().getByText("Needs repair: 1 direct failure; no chained failures."),
    ).toBeTruthy()
    const repair = timeline().getByRole("button", {
      name: "Open Dependent to repair 1 broken reference",
    })
    expect(repair.querySelector("svg")).toBeTruthy()
    await user.click(repair)
    expect(onSketchActivate).toHaveBeenCalledWith(broken.target.id)
  })

  it("uses current worker evidence to surface a broken model reference", () => {
    const broken = controllerWithBrokenModelReference()

    renderTree({ controller: broken.controller })

    expect(
      timeline().getByRole("button", {
        name: "Open Model dependent to repair 1 broken reference",
      }),
    ).toBeTruthy()
    expect(
      timeline().getByText("Needs repair: 1 direct failure; no chained failures."),
    ).toBeTruthy()
  })

  it("opens graphical support replacement directly from a missing-support badge", async () => {
    const user = userEvent.setup()
    const onSketchActivate = vi.fn()
    const onSketchSupportRepair = vi.fn()
    const broken = controllerWithMissingSketchSupport()

    renderTree({
      controller: broken.controller,
      onSketchActivate,
      onSketchSupportRepair,
    })

    expect(timeline().getByText("Needs repair: the support face is missing.")).toBeTruthy()
    const repair = timeline().getByRole("button", {
      name: "Replace the missing support for Face sketch",
    })
    await user.click(repair)
    expect(onSketchSupportRepair).toHaveBeenCalledWith(broken.target.id)
    expect(onSketchActivate).not.toHaveBeenCalled()
  })

  it("does not offer topology repair while the support owner is unavailable", () => {
    const unavailable = controllerWithMissingSketchSupport("failed")

    renderTree({ controller: unavailable.controller })

    expect(
      timeline().getByText(
        "Support status is unavailable while its source feature is unavailable.",
      ),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", {
        name: "Replace the missing support for Face sketch",
      }),
    ).toBeNull()
  })
})

describe("ModelTree browser result selection", () => {
  it("selects an unmanaged legacy body as an object when body activation is available", async () => {
    const onBodyActivate = vi.fn()
    const onFeatureActivate = vi.fn()
    renderTree({ onBodyActivate, onFeatureActivate })

    await userEvent.click(browser().getByRole("treeitem", { name: "Body 1" }))

    expect(onBodyActivate).toHaveBeenCalledTimes(1)
    expect(onBodyActivate).toHaveBeenCalledWith({ featureId })
    expect(onFeatureActivate).not.toHaveBeenCalled()
  })

  it.each([undefined, "result"])(
    "finds a terminal result through its body selection and browser reveal (%s)",
    async (outputRole) => {
      const onBodyActivate = vi.fn()
      const onFeatureActivate = vi.fn()
      const onRevealFeature = vi.fn()
      if (!controllerReport.rebuild.ok) throw new Error("Expected rebuild evidence.")
      const source = {
        ...controller,
        report: {
          ...controllerReport,
          rebuild: {
            ok: true,
            response: {
              ...controllerReport.rebuild.response,
              geometry: controllerReport.rebuild.response.geometry.map((geometry) => ({
                ...geometry,
                geometry: {
                  ...geometry.geometry,
                  ...(outputRole === undefined
                    ? {}
                    : {
                        bodies: [
                          {
                            outputRole,
                            shape: geometry.geometry.shape,
                            mesh: geometry.geometry.mesh,
                            topologyCandidates: [],
                          },
                        ],
                      }),
                },
              })),
            },
          },
        },
      } as DocumentControllerState
      renderTree({ controller: source, onBodyActivate, onFeatureActivate, onRevealFeature })

      await userEvent.click(timeline().getByRole("button", { name: "Actions for Box 1" }))
      await userEvent.click(screen.getByRole("menuitem", { name: "Find in browser" }))

      expect(onBodyActivate).toHaveBeenCalledTimes(1)
      expect(onBodyActivate).toHaveBeenCalledWith({
        featureId,
        ...(outputRole === undefined ? {} : { outputRole }),
      })
      expect(onRevealFeature).toHaveBeenCalledTimes(1)
      expect(onRevealFeature).toHaveBeenCalledWith(featureId)
      expect(onFeatureActivate).not.toHaveBeenCalled()
    },
  )

  it("prefers the authored part over a raw body when finding its terminal feature result", async () => {
    const fixture = authoredInsertionController()
    const authority = fixture.controller.authoredSnapshot
    if (!authority || authority.schemaVersion === 1) throw new Error("Expected authored parts.")
    const part = requireAuthoredFixture(authority.parts[1])
    const body = requireAuthoredFixture(part.bodyHistory.at(-1))
    const onPartSelect = vi.fn()
    const onBodyActivate = vi.fn()
    const onRevealFeature = vi.fn()
    renderTree({
      controller: { ...fixture.controller, historyInsertion: null },
      onPartSelect,
      onBodyActivate,
      onRevealFeature,
    })

    await userEvent.click(timeline().getByRole("button", { name: "Actions for Box 2" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Find in browser" }))

    expect(onPartSelect).toHaveBeenCalledTimes(1)
    expect(onPartSelect).toHaveBeenCalledWith(part.id)
    expect(onBodyActivate).not.toHaveBeenCalled()
    expect(onRevealFeature).toHaveBeenCalledWith(body.featureId)
  })

  it.each(["missing callback", "suppressed", "missing geometry", "rolled back", "superseded"])(
    "does not offer a false browser result for %s",
    async (reason) => {
      const onRevealFeature = vi.fn()
      let source = reason === "suppressed" ? suppressedController : controller
      if (reason === "missing geometry") {
        source = {
          ...controller,
          report: { ...controllerReport, rebuild: { ok: false } },
        } as DocumentControllerState
      }
      if (reason === "rolled back") {
        source = {
          ...controller,
          report: {
            ...controllerReport,
            historyItems: [
              { kind: "sketch", id: sketchId },
              { kind: "feature", id: featureId },
            ],
          },
        } as DocumentControllerState
      }
      if (reason === "superseded") {
        source = { ...authoredInsertionController().controller, historyInsertion: null }
      }
      renderTree({
        controller: source,
        activeSketchId: reason === "rolled back" ? sketchId : null,
        activeWorkspace: reason === "rolled back" ? "sketch" : "model",
        ...(reason === "missing callback" ? {} : { onRevealFeature }),
      })

      await userEvent.click(timeline().getByRole("button", { name: "Actions for Box 1" }))

      expect(screen.queryByRole("menuitem", { name: "Find in browser" }) === null).toBe(true)
      expect(onRevealFeature).not.toHaveBeenCalled()
    },
  )

  it.each([false, true])(
    "opens a collapsed browser result branch and focuses it for a reveal request (authored: %s)",
    async (authored) => {
      const user = userEvent.setup()
      const fixture = authoredInsertionController()
      const source = authored ? { ...fixture.controller, historyInsertion: null } : controller
      const targetFeatureId = authored
        ? requireAuthoredFixture(
            source.report?.snapshot.features.find(({ label }) => label === "Box 2"),
          ).id
        : featureId
      const groupName = authored ? "Parts" : "Bodies"
      const rowName = authored ? "Part Part 2" : "Body 1"
      const { rerenderTree } = renderTree({
        controller: source,
        onPartSelect: vi.fn(),
        onAuthoredMetadata: vi.fn().mockResolvedValue({ ok: true }),
      })
      const group = browser().getByRole("treeitem", { name: groupName })
      await user.click(group)
      expect(browser().queryByRole("treeitem", { name: rowName }) === null).toBe(true)

      rerenderTree({ revealRequest: { featureId: targetFeatureId, sequence: 1 } })
      const row = browser().getByRole("treeitem", { name: rowName })
      const body = row.closest<HTMLElement>("[data-feature-id]")
      if (!body) throw new Error("Expected the browser result container.")
      const scroll = vi.fn()
      body.scrollIntoView = scroll

      await waitFor(() => {
        expect(group.getAttribute("aria-expanded")).toBe("true")
        expect(document.activeElement === row).toBe(true)
        expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" })
      })
    },
  )
})

describe("ModelTree visibility and deletion", () => {
  it("deletes a feature through its actions menu after confirmation and restores focus on cancel", async () => {
    const user = userEvent.setup()
    const onFeatureRemove = vi.fn().mockResolvedValue({ ok: true })
    const onFeatureDeleted = vi.fn()
    renderTree({ activeFeatureId: null, onFeatureRemove, onFeatureDeleted })
    const actions = screen.getByRole("button", { name: "Actions for Box 1" })
    await user.click(actions)
    await user.click(screen.getByRole("menuitem", { name: "Delete Box 1…" }))
    expect(screen.getByRole("alertdialog", { name: "Delete Box 1?" })).toBeTruthy()
    expect(onFeatureRemove).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Keep feature" }))
    await waitFor(() => expect(document.activeElement).toBe(actions))
    expect(onFeatureRemove).not.toHaveBeenCalled()
    await user.click(actions)
    await user.click(screen.getByRole("menuitem", { name: "Delete Box 1…" }))
    await user.dblClick(screen.getByRole("button", { name: "Delete feature" }))
    expect(onFeatureRemove).toHaveBeenCalledTimes(1)
    expect(onFeatureRemove).toHaveBeenCalledWith(7, featureId)
    expect(onFeatureDeleted).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("uses the retained-dependent removal command when a feature has dependents", async () => {
    const dependent = featureRecordSchema.parse({
      ...feature,
      id: datumFeature.id,
      label: "Dependent box",
      dependencies: [featureId],
    })
    const onFeatureRemove = vi.fn().mockResolvedValue({ ok: true })
    renderTree({
      activeFeatureId: null,
      onFeatureRemove,
      controller: {
        ...controller,
        report: {
          ...controllerReport,
          snapshot: { ...controllerReport.snapshot, features: [feature, dependent] },
        },
      } as DocumentControllerState,
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Actions for Box 1" }))
    const deletion = screen.getByRole("menuitem", { name: "Delete Box 1…" })
    expect(deletion.getAttribute("aria-disabled")).not.toBe("true")
    await user.click(deletion)
    expect(onFeatureRemove).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Delete feature" }))
    await waitFor(() => expect(onFeatureRemove).toHaveBeenCalledWith(7, featureId))
  })

  it.each(["read-only", "active-tool", "saving"] as const)(
    "blocks History feature deletion during %s",
    async (reason) => {
      const onFeatureRemove = vi.fn()
      renderTree({
        activeFeatureId: reason === "active-tool" ? featureId : null,
        onFeatureRemove,
        controller: {
          ...controller,
          saveStatus: reason === "saving" ? "saving" : "saved",
          report: {
            ...controllerReport,
            mode: reason === "read-only" ? "read-only" : "read-write",
          },
        } as DocumentControllerState,
      })
      await userEvent.setup().click(screen.getByRole("button", { name: "Actions for Box 1" }))
      expect(
        screen.getByRole("menuitem", { name: "Delete Box 1…" }).getAttribute("aria-disabled"),
      ).toBe("true")
      expect(onFeatureRemove).not.toHaveBeenCalled()
    },
  )

  it("toggles persisted feature suppression with a single-flight menu action", async () => {
    const user = userEvent.setup()
    let resolveSuppression: ((result: { ok: true }) => void) | undefined
    const onFeatureSuppressionChange = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveSuppression = resolve
        }),
    )
    const { unmount } = renderTree({
      activeFeatureId: null,
      onFeatureSuppressionChange,
    })

    await user.click(screen.getByRole("button", { name: "Actions for Box 1" }))
    const suppress = screen.getByRole("menuitem", { name: "Suppress Box 1" })
    await user.click(suppress)

    expect(onFeatureSuppressionChange).toHaveBeenCalledTimes(1)
    expect(onFeatureSuppressionChange).toHaveBeenCalledWith(7, featureId, true)
    expect(suppress.getAttribute("aria-busy")).toBe("true")
    await user.click(suppress)
    expect(onFeatureSuppressionChange).toHaveBeenCalledTimes(1)

    resolveSuppression?.({ ok: true })
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Suppress Box 1" })).toBeNull(),
    )

    unmount()
    renderTree({
      activeFeatureId: null,
      controller: suppressedController,
      onFeatureSuppressionChange,
    })
    const suppressedRow = screen
      .getByRole("treeitem", { name: "Box 1" })
      .closest("[data-feature-suppressed]")
    expect(suppressedRow?.getAttribute("data-feature-suppressed")).toBe("true")
    expect((screen.getByRole("button", { name: "Hide Box 1" }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    await user.click(screen.getByRole("button", { name: "Actions for Box 1" }))
    await user.click(screen.getByRole("menuitem", { name: "Unsuppress Box 1" }))
    expect(onFeatureSuppressionChange).toHaveBeenLastCalledWith(7, featureId, false)
  })

  it("toggles terminal feature visibility from an icon-only accessible action", async () => {
    const user = userEvent.setup()
    const onFeatureVisibilityChange = vi.fn()
    const { unmount } = renderTree({ onFeatureVisibilityChange })

    await user.click(screen.getByRole("button", { name: "Hide Box 1" }))
    expect(onFeatureVisibilityChange).toHaveBeenCalledWith(featureId, false)

    unmount()
    renderTree({ hiddenFeatureIds: [featureId], onFeatureVisibilityChange })
    await user.click(screen.getByRole("button", { name: "Show Box 1" }))
    expect(onFeatureVisibilityChange).toHaveBeenLastCalledWith(featureId, true)
  })

  it("toggles saved sketch visibility without entering edit mode", async () => {
    const user = userEvent.setup()
    const onSketchActivate = vi.fn()
    const onSketchVisibilityChange = vi.fn()
    const { unmount } = renderTree({ onSketchActivate, onSketchVisibilityChange })

    await user.click(timeline().getByRole("button", { name: "Hide Profile" }))

    expect(onSketchVisibilityChange).toHaveBeenCalledWith(sketchId, false)
    expect(onSketchActivate).not.toHaveBeenCalled()

    unmount()
    renderTree({ hiddenSketchIds: [sketchId], onSketchVisibilityChange })
    await user.click(timeline().getByRole("button", { name: "Show Profile" }))
    expect(onSketchVisibilityChange).toHaveBeenLastCalledWith(sketchId, true)
  })

  it("toggles every saved sketch from the model-tree header", async () => {
    const user = userEvent.setup()
    const onAllSketchVisibilityToggle = vi.fn()
    const { unmount } = renderTree({ onAllSketchVisibilityToggle })

    const hideAllSketches = screen.getByRole("button", { name: "Hide all sketches" })
    await user.hover(hideAllSketches)
    expect(await screen.findByText("Hide all sketches · Shift+H")).toBeTruthy()
    await user.click(hideAllSketches)
    expect(onAllSketchVisibilityToggle).toHaveBeenCalledTimes(1)

    unmount()
    renderTree({ hiddenSketchIds: [sketchId], onAllSketchVisibilityToggle })
    expect(screen.getByRole("button", { name: "Show all sketches" })).toBeTruthy()
  })

  it("confirms and removes an unused saved sketch by stable identity", async () => {
    const user = userEvent.setup()
    const onSketchDeleted = vi.fn()
    const onSketchRemove = vi.fn().mockResolvedValue({ ok: true })

    renderTree({ onSketchDeleted, onSketchRemove })

    expect(screen.queryByRole("button", { name: /Delete Profile/ })).toBeNull()
    expect(screen.queryByRole("menuitem", { name: /Delete Profile/ })).toBeNull()
    await user.click(timeline().getByRole("button", { name: "Actions for Profile" }))
    expect(onSketchRemove).not.toHaveBeenCalled()
    await user.click(screen.getByRole("menuitem", { name: "Delete Profile…" }))
    expect(onSketchRemove).not.toHaveBeenCalled()
    expect(screen.queryByRole("menu")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Delete sketch" }))

    expect(onSketchRemove).toHaveBeenCalledWith(7, sketchId)
    expect(onSketchDeleted).toHaveBeenCalledTimes(1)
  })

  it("opens sketch deletion from the keyboard and restores focus after cancellation", async () => {
    const user = userEvent.setup()
    const onSketchRemove = vi.fn()
    renderTree({ onSketchRemove })
    const actions = timeline().getByRole("button", { name: "Actions for Profile" })
    actions.focus()
    await user.keyboard("{Enter}{ArrowDown}{Enter}")
    expect(screen.getByRole("alertdialog", { name: "Delete Profile?" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Keep sketch" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(document.activeElement).toBe(actions)
    expect(onSketchRemove).not.toHaveBeenCalled()
  })

  it.each(["legacy", "multi"] as const)(
    "confirms deletion of a sketch used by multiple %s extrusions",
    async (kind) => {
      const user = userEvent.setup()
      const onSketchRemove = vi.fn()
      const profile = {
        schemaVersion: 0 as const,
        sketchId,
        outerBoundaryEntityIds: [
          sketchEntityIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2901"),
        ],
        holeBoundaryEntityIds: [],
      }
      const extrusion = featureRecordSchema.parse({
        ...feature,
        type:
          kind === "legacy"
            ? legacyExtrusionFeatureType.type
            : multiProfileExtrusionFeatureType.type,
        parameters: {
          ...(kind === "legacy" ? { profile } : { profiles: createSketchProfileSet([profile]) }),
          distance: createLengthQuantity(10),
          symmetric: false,
          operation: "new",
        },
      })
      const source = {
        ...controller,
        report: {
          ...controllerReport,
          snapshot: {
            ...controllerReport.snapshot,
            features: [
              extrusion,
              featureRecordSchema.parse({
                ...extrusion,
                id: "0195b5ac-b220-7a2c-8c33-67a36a7f2903",
                suppressed: true,
              }),
            ],
          },
        },
      } as DocumentControllerState
      renderTree({ controller: source, onSketchRemove })
      await user.click(timeline().getByRole("button", { name: "Actions for Profile" }))
      const deletion = screen.getByRole("menuitem", { name: "Delete Profile…" })
      expect(deletion.getAttribute("aria-disabled")).not.toBe("true")
      await user.click(deletion)
      expect(screen.getByRole("alertdialog", { name: "Delete Profile?" })).toBeTruthy()
      await user.click(screen.getByRole("button", { name: "Delete sketch" }))
      expect(onSketchRemove).toHaveBeenCalledTimes(1)
      expect(onSketchRemove).toHaveBeenCalledWith(7, sketchId)
    },
  )
})

describe("ModelTree rename", () => {
  it("renames a feature once from its discoverable model-tree action", async () => {
    const user = userEvent.setup()
    const onFeatureRename = vi.fn().mockResolvedValue({ ok: true })
    renderTree({ onFeatureRename })

    await user.click(screen.getByRole("button", { name: "Actions for Box 1" }))
    await user.click(screen.getByRole("menuitem", { name: "Rename Box 1…" }))
    await user.clear(screen.getByRole("textbox", { name: "Feature name" }))
    await user.type(screen.getByRole("textbox", { name: "Feature name" }), "Mounting block")
    await user.dblClick(screen.getByRole("button", { name: /^Rename feature$/ }))

    expect(onFeatureRename).toHaveBeenCalledTimes(1)
    expect(onFeatureRename).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ id: featureId, label: "Mounting block" }),
    )
  })

  it("opens sketch rename with F2 and blocks the sketch currently being edited", async () => {
    const user = userEvent.setup()
    const onSketchRename = vi.fn().mockResolvedValue({ ok: true })
    const { unmount } = renderTree({ onSketchRename })

    const sketchItem = screen.getByRole("treeitem", { name: "Profile" })
    sketchItem.focus()
    await user.keyboard("{F2}")
    await user.clear(screen.getByRole("textbox", { name: "Sketch name" }))
    await user.type(screen.getByRole("textbox", { name: "Sketch name" }), "Mounting profile")
    await user.click(screen.getByRole("button", { name: /^Rename sketch$/ }))
    expect(onSketchRename).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ id: sketchId, label: "Mounting profile" }),
    )

    unmount()
    renderTree({ sketchRenameBlockedId: sketchId })
    await user.click(timeline().getByRole("button", { name: "Actions for Profile" }))
    expect(
      screen.getByRole("menuitem", { name: "Rename Profile…" }).getAttribute("aria-disabled"),
    ).toBe("true")
  })
})
