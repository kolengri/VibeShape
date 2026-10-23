import "../../../../tests/unit/support/dom"
import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test"
import type { ComponentProps } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"

const preserve = vi.fn(async () => ({ ok: true as const }))
const documentController = { ...(await import("../document/document-controller")) }
mock.module("../document/document-controller", () => ({
  ...documentController,
  removeFeaturePreservingModelReferenceIntent: preserve,
}))

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { createRef } = await import("react")
const {
  boxFeatureType,
  createLengthQuantity,
  documentSnapshotSchema,
  featureRecordSchema,
  sketchRecordSchema,
} = await import("@vibeshape/domain")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const { i18n } = await import("../i18n")
const { HistoryFeatureActions } = await import("./history-feature-actions")

const id = (suffix: string) => `0195b5ac-b220-7a2c-8c33-67a36a7f${suffix}`
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: id("4101"),
  type: boxFeatureType.type,
  parameters: {
    width: createLengthQuantity(20),
    depth: createLengthQuantity(30),
    height: createLengthQuantity(40),
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Box 1",
})
const sketch = sketchRecordSchema.parse({
  schemaVersion: 0,
  id: id("4102"),
  label: "Repairable sketch",
  plane: "xy",
  entities: [],
  constraints: [],
  externalReferences: [
    {
      schemaVersion: 0,
      id: id("4103"),
      kind: "model-point",
      projectedPointId: id("4104"),
      reference: {
        schemaVersion: 0,
        featureId: feature.id,
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
    },
  ],
})

function setup({ references = false, disabled = false } = {}) {
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id("4105"),
    revision: 7,
    name: "History deletion",
    createdAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:00Z",
    features: [feature],
    sketches: references ? [sketch] : [],
  })
  const props: ComponentProps<typeof HistoryFeatureActions> = {
    controller: {
      status: "ready",
      saveStatus: "saved",
      diagnostic: null,
      report: {
        status: "clean",
        mode: "read-write",
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
    },
    deleteDisabled: disabled,
    feature,
    label: "Box 1",
    onDeleted: vi.fn(),
    onRemove: vi.fn(async () => ({ ok: true as const })),
    onRename: vi.fn(),
    onSuppressionChange: vi.fn(async () => ({ ok: true as const })),
    renameDisabled: false,
    renameOpen: false,
    triggerRef: createRef<HTMLButtonElement>(),
  }
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <HistoryFeatureActions {...props} />
      </TooltipProvider>
    </I18nProvider>,
  )
  return props
}

beforeAll(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
)

afterEach(() => {
  cleanup()
  preserve.mockReset().mockResolvedValue({ ok: true })
})

describe("History feature deletion", () => {
  it("keeps ordinary deletion hidden in the menu and requires confirmation", async () => {
    const props = setup()
    const user = userEvent.setup()
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Actions for Box 1" }))
    expect(screen.queryByRole("menuitem", { name: "Delete and keep references" })).toBeNull()
    await user.click(screen.getByRole("menuitem", { name: "Delete Box 1…" }))
    expect(props.onRemove).not.toHaveBeenCalled()
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete feature" }),
    )
    expect(props.onRemove).toHaveBeenCalledWith(7, feature.id)
    expect(props.onDeleted).toHaveBeenCalledTimes(1)
  })

  it("lists affected sketch references and preserves them only after confirmation", async () => {
    const props = setup({ references: true })
    const user = userEvent.setup()
    const trigger = screen.getByRole("button", { name: "Actions for Box 1" })
    await user.click(trigger)
    await user.click(screen.getByRole("menuitem", { name: "Delete and keep references" }))
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete Box 1 and keep sketch references?",
    })
    expect(within(dialog).getByText("Sketch references that will need repair")).toBeTruthy()
    expect(within(dialog).getByRole("listitem").textContent).toContain("Repairable sketch")
    expect(preserve).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole("button", { name: "Keep feature" }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(preserve).not.toHaveBeenCalled()
    await user.click(trigger)
    await user.click(screen.getByRole("menuitem", { name: "Delete and keep references" }))
    await user.dblClick(screen.getByRole("button", { name: "Delete and keep references" }))
    expect(preserve).toHaveBeenCalledTimes(1)
    expect(preserve).toHaveBeenCalledWith(7, feature.id)
    expect(props.onRemove).not.toHaveBeenCalled()
    expect(props.onDeleted).toHaveBeenCalledTimes(1)
  })

  it("retains the confirmation and repair list when preserve-intent deletion fails", async () => {
    preserve.mockRejectedValueOnce(new Error("Save failed"))
    const props = setup({ references: true })
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Actions for Box 1" }))
    await user.click(screen.getByRole("menuitem", { name: "Delete and keep references" }))
    await user.click(screen.getByRole("button", { name: "Delete and keep references" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("could not be deleted while keeping"),
    )
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(screen.getByRole("listitem").textContent).toContain("Repairable sketch")
    expect(props.onDeleted).not.toHaveBeenCalled()
    expect(props.onRemove).not.toHaveBeenCalled()
  })

  it("applies the existing History write lock to both deletion options", async () => {
    setup({ references: true, disabled: true })
    await userEvent.setup().click(screen.getByRole("button", { name: "Actions for Box 1" }))
    for (const name of ["Delete Box 1…", "Delete and keep references"]) {
      expect(screen.getByRole("menuitem", { name }).getAttribute("aria-disabled")).toBe("true")
    }
    expect(preserve).not.toHaveBeenCalled()
  })
})
