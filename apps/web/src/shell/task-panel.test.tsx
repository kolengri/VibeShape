// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { documentSnapshotSchema, featureRecordSchema } from "@vibeshape/domain"
import { meshImportFeatureType } from "@vibeshape/domain/part-design-mesh-import"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../document/document-controller"
import { removeFeature } from "../document/document-controller"
import { editPartDesignTool } from "../features/part-design/part-design-tool"
import { i18n } from "../i18n"
import { TaskPanel } from "./task-panel"

vi.mock("../document/document-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../document/document-controller")>()),
  removeFeature: vi.fn(async () => ({ ok: true })),
}))

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

function renderImportedTask(mode: "read-write" | "read-only" = "read-write") {
  const controller: DocumentControllerState = {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      status: "clean",
      mode,
      snapshot,
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
  const onCloseTool = vi.fn()
  const props: ComponentProps<typeof TaskPanel> = {
    controller,
    workspace: "model",
    activeTool: editPartDesignTool(feature),
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
  }
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TaskPanel {...props} />
    </I18nProvider>,
  )
  return { onCompleteTool, onCloseTool }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("captured-source History task", () => {
  it("deletes an organic lightweighting feature through the ordinary confirmed removal command", async () => {
    const user = userEvent.setup()
    const { onCompleteTool } = renderImportedTask()
    expect(screen.getByRole("heading", { name: "Organic lightweighting" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Delete feature" }))
    expect(removeFeature).not.toHaveBeenCalled()
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete feature" }),
    )
    expect(removeFeature).toHaveBeenCalledExactlyOnceWith(7, feature.id)
    expect(onCompleteTool).toHaveBeenCalledOnce()
  })

  it("closes the captured-source task without changing History", async () => {
    const user = userEvent.setup()
    const { onCloseTool } = renderImportedTask()
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(onCloseTool).toHaveBeenCalledOnce()
    expect(removeFeature).not.toHaveBeenCalled()
  })

  it("keeps deletion unavailable with a visible reason in a read-only document", () => {
    renderImportedTask("read-only")
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Delete feature" }).disabled).toBe(
      true,
    )
    expect(screen.getByText("Open the document with write access to delete features.")).toBeTruthy()
  })
})
