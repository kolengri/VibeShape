// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  featureIdSchema,
  featureRecordSchema,
  filletFeatureType,
  filletFeatureTypeV2,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { EdgeTreatmentForm } from "./edge-treatment-form"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4701")
const targetId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4702")
const secondTargetId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4703")
const edgeCandidate = {
  candidateId: "edge-1",
  kind: "edge" as const,
  lineageTokens: [],
  signature: {
    kind: "edge" as const,
    geometryClass: "LINE",
    measure: 1,
    centroid: [0, 0, 0] as [number, number, number],
    bounds: {
      min: [0, 0, 0] as [number, number, number],
      max: [1, 0, 0] as [number, number, number],
    },
    boundaryCount: 0,
    adjacentGeometryClasses: [],
  },
}
const topologyCandidates = [
  { featureId: targetId, geometry: { topologyCandidates: [edgeCandidate] } },
  { featureId: secondTargetId, geometry: { topologyCandidates: [edgeCandidate] } },
]
const copy = {
  title: "Fillet edges",
  description: "Apply a fillet to all edges of the target body.",
  parameters: "All edges",
  scopeLabel: "Edges",
  allEdges: "All edges",
  selectedEdges: "Selected edges",
  selectedEdgesDescription: "Pick one or more edges.",
  edgeLabel: (ordinal: number) => `Edge ${ordinal}`,
  removeEdge: "Remove",
  clearEdges: "Clear",
  pickEdges: "Pick edges",
  missingEdge: "Select at least one valid edge.",
  ambiguousEdge: "This edge is ambiguous.",
  target: "Target body",
  targetDescription: "Choose the body whose edges will all be treated.",
  missingTarget: "Select a target body.",
  distance: "Radius",
  expressionDescription: "Enter a positive length or #variable.",
  invalidExpression: "Enter a valid expression.",
  invalidDimension: "Expression must resolve to a length.",
  invalidRange: "Enter a positive supported length.",
  validationSummary: "Fix the highlighted value.",
  submit: "Create fillet",
  cancel: "Cancel",
  staleRevision: "The document changed.",
  saveFailed: "The fillet could not be created.",
} as const

const existing = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: filletFeatureType.type,
  parameters: { radius: createLengthQuantity(2, "mm", "2 mm") },
  dependencies: [targetId],
  references: [],
  suppressed: false,
  label: "Fillet 1",
})

function renderForm(overrides: Partial<React.ComponentProps<typeof EdgeTreatmentForm>> = {}) {
  const defaults: React.ComponentProps<typeof EdgeTreatmentForm> = {
    baseRevision: 3,
    copy,
    mode: { kind: "create", createFeatureId: () => featureId, featureLabel: "Fillet 1" },
    operation: "fillet",
    options: [{ id: targetId, label: "Box 1" }],
    variables: [],
    onCancel: vi.fn(),
    onSave: vi.fn(async () => ({ ok: true as const })),
    onSaved: vi.fn(),
    onPreviewChange: vi.fn(),
  }
  const props = { ...defaults, ...overrides }
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <EdgeTreatmentForm {...props} />
    </I18nProvider>,
  )
  return { onSave: props.onSave }
}

afterEach(cleanup)

describe("EdgeTreatmentForm", () => {
  it("rejects invalid length expressions without committing", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()
    const radius = screen.getByRole("combobox", { name: copy.distance })
    await user.clear(radius)
    await user.type(radius, "not-a-length")
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(await screen.findByText(copy.invalidExpression)).toBeTruthy()
    expect((radius as HTMLInputElement).value).toBe("not-a-length")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("preserves edit expressions and previews the same feature identity", async () => {
    const onPreviewChange = vi.fn()
    const onSave = vi.fn(async () => ({ ok: true as const }))
    renderForm({ mode: { kind: "edit", feature: existing }, onPreviewChange, onSave })
    expect((screen.getByRole("combobox", { name: copy.distance }) as HTMLInputElement).value).toBe(
      "2 mm",
    )
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: featureId, type: filletFeatureType.type }),
      ),
    )
    await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(3, expect.objectContaining({ id: featureId }))
  })

  it("uses chamfer distance and suppresses duplicate activation while saving", async () => {
    let resolve: (value: { ok: true }) => void = () => undefined
    const onSave = vi.fn(
      () =>
        new Promise<{ ok: true }>((done) => {
          resolve = done
        }),
    )
    renderForm({ operation: "chamfer", onSave })
    const user = userEvent.setup()
    const submit = screen.getByRole("button", { name: copy.submit })
    await user.dblClick(submit)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(submit.getAttribute("aria-busy")).toBe("true")
    resolve({ ok: true })
  })

  it("does not submit from Enter while the preview is still loading", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm({ previewStatus: "loading" })
    await user.click(screen.getByRole("combobox", { name: copy.distance }))
    await user.keyboard("{Enter}")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("releases the submit lock and reports a rejected save", async () => {
    const user = userEvent.setup()
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValue({ ok: true as const })
    const { onSave: save } = renderForm({ onSave })
    const submit = screen.getByRole("button", { name: copy.submit })
    await user.click(submit)
    expect(await screen.findByText(copy.saveFailed)).toBeTruthy()
    await user.click(submit)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it("saves selected edges as a v2 feature", async () => {
    const onSave = vi.fn(async () => ({ ok: true as const }))
    renderForm({ onSave, topologyCandidates })
    const user = userEvent.setup()
    await user.click(screen.getByRole("radio", { name: copy.selectedEdges }))
    await user.selectOptions(screen.getByRole("combobox", { name: copy.pickEdges }), "edge-1")
    await user.click(screen.getByRole("button", { name: copy.submit }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        3,
        expect.objectContaining({
          type: filletFeatureTypeV2.type,
          references: [expect.objectContaining({ featureId: targetId, kind: "edge" })],
        }),
      ),
    )
  })

  it("keeps a selected reference broken when its target changes", async () => {
    const selected = featureRecordSchema.parse({
      ...existing,
      type: filletFeatureTypeV2.type,
      dependencies: [targetId],
      references: [
        { schemaVersion: 0, featureId: targetId, kind: "edge", signature: edgeCandidate.signature },
      ],
    })
    const onSave = vi.fn(async () => ({ ok: true as const }))
    const onPreviewChange = vi.fn()
    renderForm({
      mode: { kind: "edit", feature: selected },
      options: [
        { id: targetId, label: "Box 1" },
        { id: secondTargetId, label: "Box 2" },
      ],
      topologyCandidates,
      onSave,
      onPreviewChange,
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole("combobox", { name: copy.target }))
    await user.selectOptions(screen.getByRole("combobox", { name: copy.target }), secondTargetId)
    await waitFor(() => expect(onPreviewChange).toHaveBeenLastCalledWith(null))
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(await screen.findByText(copy.missingEdge)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: copy.removeEdge }))
    await user.selectOptions(screen.getByRole("combobox", { name: copy.pickEdges }), "edge-1")
    await user.click(screen.getByRole("button", { name: copy.submit }))
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith(
        3,
        expect.objectContaining({
          references: [expect.objectContaining({ featureId: secondTargetId })],
        }),
      ),
    )
  })
})
