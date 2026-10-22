import "../../../../tests/unit/support/dom"

import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test"
import type { FeatureRecord } from "@vibeshape/domain"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"
import type { ExactBodyOption } from "../features/part-design/exact-body-options"

const candidates = (() => ({ options: [] as readonly ExactBodyOption[] }))()
mock.module("../features/part-design/exact-body-options", () => ({
  exactSolidBodyOptions: vi.fn(() => candidates.options),
}))

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { createAngleQuantity, createLengthQuantity, featureIdSchema, featureRecordSchema } =
  await import("@vibeshape/domain")
const { missingInputFeatureType } = await import("@vibeshape/domain/history-repair")
const { placementFeatureType } = await import("@vibeshape/domain/part-design-placement")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { PlacementForm } = await import("../features/placement/placement-form")
const { i18n } = await import("../i18n")
const { default: messages } = await import("../i18n/messages/en.json")
const { HistoryFeatureRepair } = await import("./history-feature-repair")

const sourceId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f9901")
const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f9902")
const replacementId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f9903")
const target = { schemaVersion: 0 as const, featureId: sourceId, outputRole: "result" }
const zero = createLengthQuantity(0)
const angle = createAngleQuantity(0, "deg")
const original = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: placementFeatureType.type,
  label: "Placement 1",
  parameters: {
    targetBody: target,
    translation: { x: createLengthQuantity(30, "mm", "25 mm + 5 mm"), y: zero, z: zero },
    rotation: { x: angle, y: angle, z: angle },
  },
  dependencies: [sourceId],
  references: [],
  suppressed: false,
})
const missingInputs = [{ kind: "feature" as const, id: sourceId }]
const active = {
  ...original,
  type: missingInputFeatureType,
  parameters: { missingInputs },
  dependencies: [],
}
const authority = {
  schemaVersion: 5,
  id: sourceId,
  revision: 7,
  parts: [],
  features: [{ ...active, schemaVersion: 1, semanticInputs: [] }],
  repairIntents: [
    {
      kind: "feature",
      authored: { ...original, schemaVersion: 1, semanticInputs: [] },
      missingInputs,
    },
  ],
}
const controller = {
  status: "ready",
  saveStatus: "saved",
  authoredSnapshot: authority,
  report: {
    mode: "read-write",
    snapshot: { id: sourceId, revision: 7, features: [active], variables: [], sketches: [] },
    rebuild: { ok: false },
  },
} as unknown as DocumentControllerState
const option = {
  id: "replacement-instance",
  label: "Earlier part",
  body: { schemaVersion: 0 as const, featureId: replacementId, outputRole: "pattern.instance.2" },
}
const copy = {
  ...messages.app.placement,
  title: messages.app.placement.editTitle,
  submit: messages.app.placement.update,
  invalidRange: messages.app.placement.invalidTranslationRange,
}
function setup() {
  candidates.options = [option]
  const onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({
    ok: true as const,
  }))
  const onClose = vi.fn()
  function view(state: DocumentControllerState) {
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <HistoryFeatureRepair
          controller={state}
          tool={{ kind: "edit-placement", featureId }}
          onClose={onClose}
          renderDelete={() => <button type="button">Delete retained feature</button>}
        >
          {(context) => {
            const feature = context.report?.snapshot.features.find(({ id }) => id === featureId)
            return feature ? (
              <PlacementForm
                baseRevision={7}
                mode={{ kind: "edit", feature }}
                copy={copy}
                variables={[]}
                onCancel={onClose}
                onSave={onSave}
                onSaved={vi.fn()}
              />
            ) : null
          }}
        </HistoryFeatureRepair>
      </I18nProvider>
    )
  }
  const rendered = render(view(controller))
  return {
    ...rendered,
    onSave,
    onClose,
    rerenderState: (state: DocumentControllerState) => rendered.rerender(view(state)),
  }
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
afterEach(cleanup)

describe("explicit retained body input repair", () => {
  it("waits for explicit selection, preserves authored expression and submits the original feature identity", async () => {
    const { onSave } = setup()
    const picker = screen.getByRole("combobox", { name: "Replacement body" })
    const description = document.getElementById(picker.getAttribute("aria-describedby") ?? "")
    expect(description?.textContent).toBe(messages.app.historyFeatureRepair.description)
    expect(description?.closest("[role=dialog]")).toBeNull()
    expect(description?.closest("header")).not.toBeNull()
    expect((picker as HTMLSelectElement).value).toBe("")
    expect(screen.queryByRole("button", { name: "Update placement" })).toBeNull()
    expect(screen.getByRole("button", { name: "Delete retained feature" })).toBeTruthy()
    const header = screen.getByRole("button", { name: "Cancel" }).closest("header")
    expect(header).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Delete retained feature" }).closest("header"),
    ).not.toBe(header)
    await userEvent.selectOptions(picker, option.id)
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1)
    expect(document.querySelectorAll("header")).toHaveLength(1)
    const repairHeader = screen.getByRole("button", { name: "Update placement" }).closest("header")
    expect(repairHeader).not.toBeNull()
    expect(screen.getByRole("button", { name: "Cancel" }).closest("header")).toBe(repairHeader)
    expect(screen.getByRole("combobox", { name: "Replacement body" }).closest("header")).toBe(
      repairHeader,
    )
    const expression = screen.getByRole("combobox", { name: "Translate X" })
    expect((expression as HTMLInputElement).value).toBe("25 mm + 5 mm")
    expect(onSave).not.toHaveBeenCalled()
    expect(authority.repairIntents[0]?.authored.parameters).toEqual(original.parameters)
    await userEvent.click(screen.getByRole("button", { name: "Update placement" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({
      id: featureId,
      dependencies: [replacementId],
      parameters: {
        targetBody: option.body,
        translation: { x: { value: 30, source: { expression: "25 mm + 5 mm" } } },
      },
    })
  })

  it("drops stale candidates, preserves cancellation and deletion, and locks the picker during save", async () => {
    const { onSave, onClose, rerenderState } = setup()
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Replacement body" }),
      option.id,
    )
    rerenderState({ ...controller, saveStatus: "saving" })
    expect(
      (screen.getByRole("combobox", { name: "Replacement body" }) as HTMLSelectElement).disabled,
    ).toBe(true)
    candidates.options = []
    rerenderState(controller)
    expect(screen.queryByRole("button", { name: "Update placement" })).toBeNull()
    expect(screen.getByRole("status").textContent).toContain("No earlier exact solid bodies")
    expect(screen.getByRole("button", { name: "Delete retained feature" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
