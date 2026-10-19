import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ComponentProps } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"

const ports = (() => ({
  registerSubmission: vi.fn(),
  removeFeature: vi.fn(async () => ({ ok: true })),
}))()
const originalModule1 = { ...(await import("../editor-session/editor-session-provider")) }
mock.module("../editor-session/editor-session-provider", () => ({
  ...originalModule1,
  useRegisterTaskSubmission: ports.registerSubmission,
}))

const originalModule2 = { ...(await import("../document/document-controller")) }
mock.module("../document/document-controller", () => ({
  ...originalModule2,
  removeFeature: ports.removeFeature,
}))

const { act, cleanup, render, screen, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const {
  createLengthQuantity,
  createEmptySketch,
  datumPlaneFeatureTypeV1,
  documentSnapshotSchema,
  featureRecordSchema,
  sketchIdSchema,
} = await import("@vibeshape/domain")
const { meshImportFeatureType } = await import("@vibeshape/domain/part-design-mesh-import")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { removeFeature } = await import("../document/document-controller")
const { createEditorSessionStore } = await import("../editor-session/editor-session-store")
const { createHistoryNavigation } = await import("../editor-session/history-navigation")
const { editPartDesignTool } = await import("../features/part-design/part-design-tool")
const { i18n } = await import("../i18n")
const { TaskPanel } = await import("./task-panel")

const id = "0195b5ac-b220-7a2c-8c33-67a36a7f2701"
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id,
  type: meshImportFeatureType.type,
  parameters: {
    sourceAssetId: "0195b5ac-b220-7a2c-8c33-67a36a7f2702",
    source: {
      digest: "a".repeat(64),
      byteLength: 134,
      format: "stl",
      normalization: {
        sourceUnit: "millimeter",
        scaleToMillimeters: 1,
        normalizedUnit: "millimeter",
      },
      parserPolicyVersion: 1,
    },
    outputs: [{ outputId: "0195b5ac-b220-7a2c-8c33-67a36a7f2703", nodeKey: "mesh-1" }],
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Organic lightweighting",
})
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: "0195b5ac-b220-7a2c-8c33-67a36a7f2704",
  revision: 7,
  name: "Lightweighting",
  createdAt: "2026-10-07T00:00:00Z",
  updatedAt: "2026-10-07T00:00:00Z",
  features: [feature],
})

function renderFeatureTask(
  mode: "read-write" | "read-only" = "read-write",
  close = () => {},
  selectedFeature = feature,
  overrides: Partial<ComponentProps<typeof TaskPanel>> = {},
) {
  const controller: DocumentControllerState = {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      status: "clean",
      mode,
      snapshot: { ...snapshot, features: [selectedFeature] },
      historyItems: null,
      rebuild: {
        ok: false,
        diagnostic: {
          code: "rebuild-failed",
          message: "Not needed",
          retryable: false,
          sourceCode: null,
        },
      },
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: null,
    },
  }
  const onCompleteTool = vi.fn()
  const onCloseTool = vi.fn(close)
  const props: ComponentProps<typeof TaskPanel> = {
    controller,
    workspace: "model",
    activeTool: editPartDesignTool(selectedFeature),
    activeSketchId: null,
    activeSketchTool: null,
    extrusionDistanceRequest: null,
    featurePreviewStatus: "idle",
    primitivePlacementRequest: null,
    revolveAngleRequest: null,
    sketchDraft: null,
    sketchFailedConstraintIds: [],
    sketchProfiles: [],
    sketchReferenceDimensionLabels: {},
    sketchRepairReferenceId: null,
    sketchSelectedConstraintId: null,
    sketchSelectedEntityIds: [],
    sketchSelectedProfile: null,
    onCloseTool,
    onCompleteTool,
    onCreateBox: vi.fn(),
    onCreateCylinder: vi.fn(),
    onCreateSphere: vi.fn(),
    onCreateCone: vi.fn(),
    onCreatePyramid: vi.fn(),
    onCreateTorus: vi.fn(),
    onCreateExtrusion: vi.fn(async () => false),
    onCreateSketch: vi.fn(),
    onCreateSubtract: vi.fn(),
    onFeaturePreviewChange: vi.fn(),
    onSketchDraftChange: vi.fn(),
    onSketchPlaneSelect: vi.fn(),
    onSketchReferenceRepairChange: vi.fn(),
    onSketchSupportReplace: vi.fn(),
    onSketchSelectedConstraintChange: vi.fn(),
    onSketchSelectedProfileChange: vi.fn(),
    onSketchSaved: vi.fn(),
    ...overrides,
  }
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TaskPanel {...props} />
    </I18nProvider>,
  )
  return { ...view, props, onCompleteTool, onCloseTool }
}

beforeEach(() => ports.removeFeature.mockResolvedValue({ ok: true }))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe("captured-source History task", () => {
  it("keeps the selected saved sketch's parameters after removing idle onboarding", () => {
    const task = renderFeatureTask("read-write", () => {}, feature, { activeTool: null })
    const report = task.props.controller.report
    if (!report) throw new Error("Expected a saved document fixture")
    const sketch = createEmptySketch({
      id: sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2790"),
      label: "Mounting profile",
      plane: "xy",
    })
    task.rerender(
      <I18nProvider i18n={i18n} initialLocale="en">
        <TaskPanel
          {...task.props}
          activeSketchId={sketch.id}
          controller={{
            ...task.props.controller,
            report: { ...report, snapshot: { ...report.snapshot, sketches: [sketch] } },
          }}
        />
      </I18nProvider>,
    )
    expect(screen.getByRole("heading", { name: "Mounting profile" })).toBeTruthy()
    expect(screen.queryByText("Start with a sketch")).toBeNull()
  })
  it.each(["model", "sketch"] as const)(
    "leaves no onboarding panel in the idle %s workspace",
    (workspace) => {
      renderFeatureTask("read-write", () => {}, feature, { activeTool: null, workspace })
      expect(screen.queryByRole("complementary")).toBeNull()
      expect(screen.queryByText("Start with a sketch")).toBeNull()
      expect(screen.queryByRole("button", { name: "Create sketch" })).toBeNull()
    },
  )
  it("opens the legacy datum edit form through the real feature router without upgrading it", () => {
    const legacy = featureRecordSchema.parse({
      ...feature,
      type: datumPlaneFeatureTypeV1.type,
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(8),
      },
      label: "Legacy datum plane",
    })
    renderFeatureTask("read-write", undefined, legacy)
    const form = screen.getByRole("form", { name: "Edit datum plane" })
    expect(within(form).getByRole<HTMLInputElement>("combobox", { name: "Offset" }).value).toBe(
      "8 mm",
    )
    expect(within(form).getByRole<HTMLInputElement>("combobox", { name: "Angle" }).value).toBe(
      "0 deg",
    )
    expect(legacy.type.schemaVersion).toBe(1)
    expect(legacy.parameters).not.toHaveProperty("rotation")
  })

  it("closes inspection before navigating to another History row without saving geometry", async () => {
    const store = createEditorSessionStore()
    const tool = editPartDesignTool(feature)
    if (!tool) throw new Error("The captured feature requires an inspection tool.")
    store.getState().actions.startPartDesignTool(tool)
    const navigation = createHistoryNavigation(store)
    ports.registerSubmission.mockImplementation((submit) => navigation.register(submit))
    const { onCloseTool } = renderFeatureTask(
      "read-write",
      store.getState().actions.closeActiveTool,
    )
    const activate = vi.fn()
    await act(async () => expect(await navigation.navigate(activate)).toBe(true))
    expect(onCloseTool).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledTimes(1)
    expect(store.getState().activePartDesignTool).toBeNull()
    expect(removeFeature).not.toHaveBeenCalled()
  })

  it("deletes an organic lightweighting feature through the ordinary confirmed removal command", async () => {
    const user = userEvent.setup()
    const { onCompleteTool } = renderFeatureTask()
    expect(screen.getByRole("heading", { name: "Organic lightweighting" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Delete feature" }))
    expect(removeFeature).not.toHaveBeenCalled()
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete feature" }),
    )
    expect(removeFeature).toHaveBeenCalledTimes(1)
    expect(removeFeature).toHaveBeenCalledWith(7, feature.id)
    expect(onCompleteTool).toHaveBeenCalledTimes(1)
  })

  it("closes the captured-source task without changing History", async () => {
    const user = userEvent.setup()
    const { onCloseTool } = renderFeatureTask()
    const close = screen.getByRole("button", { name: "Close" })
    const header = close.closest("header")
    expect(header).not.toBeNull()
    expect(screen.getByRole("heading", { name: "Organic lightweighting" }).closest("header")).toBe(
      header,
    )
    expect(screen.getByRole("button", { name: "Delete feature" }).closest("header")).not.toBe(
      header,
    )
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1)
    await user.click(close)
    expect(onCloseTool).toHaveBeenCalledTimes(1)
    expect(removeFeature).not.toHaveBeenCalled()
  })

  it("keeps deletion unavailable with a visible reason in a read-only document", () => {
    renderFeatureTask("read-only")
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Delete feature" }).disabled).toBe(
      true,
    )
    expect(screen.getByText("Open the document with write access to delete features.")).toBeTruthy()
  })
})
