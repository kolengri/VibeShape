// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  extrusionFeatureType,
  featureIdSchema,
  featureRecordSchema,
  sketchProfileSelectorSchema,
  topoRefSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { ExtrusionForm, type ExtrusionFormMode } from "./extrusion-form"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3601")
const supportFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3603")
const supportReference = topoRefSchema.parse({
  schemaVersion: 0,
  featureId: supportFeatureId,
  kind: "face",
  semanticRole: "extrusion.cap.end",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 400,
    centroid: [0, 0, 10],
    bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
    direction: [0, 0, 1],
    directionMode: "oriented",
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE"],
  },
})
const profile = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3211"],
  holeBoundaryEntityIds: [],
})
const replacementProfile = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3202",
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3212"],
  holeBoundaryEntityIds: [],
})
const variables = [
  {
    schemaVersion: 0 as const,
    id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2601"),
    name: "depth",
    expression: "18 mm",
  },
]
const copy = {
  title: "Extrude profile",
  description: "Create a new solid.",
  parameters: "Extrusion parameters",
  profile: "Selected profile",
  operation: "Result operation",
  operationNew: "New body",
  operationAdd: "Add to body",
  operationRemove: "Remove from body",
  operationIntersect: "Intersect with body",
  target: "Target body",
  targetDescription: "Choose a terminal body.",
  missingTarget: "Select a target body.",
  distance: "Distance",
  symmetric: "Extrude symmetrically",
  expressionDescription: "Enter a length or #variable.",
  submit: "Create extrusion",
  cancel: "Cancel",
  invalidExpression: "Enter a valid expression.",
  invalidDimension: "Expression must resolve to a length.",
  invalidRange: "Enter a positive supported length.",
  validationSummary: "Fix the highlighted distance.",
  staleRevision: "The document changed.",
  saveFailed: "The extrusion could not be created.",
} as const

const existingFeature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: extrusionFeatureType.type,
  parameters: {
    profile,
    distance: createLengthQuantity(18, "mm", "#depth"),
    symmetric: true,
    operation: "new",
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Extrusion 1",
})

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function renderForm(
  onSave = vi.fn(async () => ({ ok: true as const })),
  onSaved = vi.fn(),
  mode: ExtrusionFormMode = {
    kind: "create",
    createFeatureId: () => featureId,
    featureLabel: "Extrusion 1",
    profile,
  },
  onPreviewChange = vi.fn(),
) {
  const formCopy = mode.kind === "edit" ? { ...copy, submit: "Update extrusion" } : copy
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <ExtrusionForm
        baseRevision={4}
        copy={formCopy}
        mode={mode}
        options={[
          {
            id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3602"),
            label: "Box 1",
          },
        ]}
        profileLabel="Sketch 1"
        variables={variables}
        onCancel={vi.fn()}
        onPreviewChange={onPreviewChange}
        onSave={onSave}
        onSaved={onSaved}
      />
    </I18nProvider>,
  )
  return { formCopy, onPreviewChange, onSave, onSaved }
}

afterEach(cleanup)

describe("ExtrusionForm", () => {
  it("publishes a debounced schema-valid draft without committing it", async () => {
    const user = userEvent.setup()
    const { onPreviewChange, onSave } = renderForm()

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: featureId, parameters: expect.objectContaining({}) }),
      ),
    )
    const distance = screen.getByRole("combobox", { name: copy.distance })
    await user.clear(distance)
    await user.type(distance, "25 mm")

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: featureId,
          parameters: expect.objectContaining({
            distance: expect.objectContaining({ value: 25 }),
          }),
        }),
      ),
    )
    expect(onSave).not.toHaveBeenCalled()
  })

  it("resolves a variable and guards asynchronous double submission", async () => {
    const user = userEvent.setup()
    const submission = deferred()
    const onSave = vi.fn(async () => {
      await submission.promise
      return { ok: true as const }
    })
    const { onSaved } = renderForm(onSave)
    const distance = screen.getByRole("combobox", { name: copy.distance })
    await user.clear(distance)
    await user.type(distance, "#depth")
    const create = screen.getByRole("button", { name: copy.submit })
    await user.dblClick(create)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        id: featureId,
        parameters: expect.objectContaining({
          profile,
          distance: expect.objectContaining({
            value: 18,
            source: { expression: "#depth", value: 18, unit: "mm" },
          }),
        }),
      }),
    )
    expect(create.getAttribute("aria-busy")).toBe("true")
    submission.resolve()
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it("preserves invalid raw input and focuses the distance error", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()
    const distance = screen.getByRole("combobox", { name: copy.distance })
    await user.clear(distance)
    await user.type(distance, "#missing")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(await screen.findByText(copy.invalidExpression)).toBeTruthy()
    expect((distance as HTMLInputElement).value).toBe("#missing")
    expect(document.activeElement).toBe(distance)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("restores the source expression and updates the existing identity", async () => {
    const user = userEvent.setup()
    const mode = { kind: "edit", feature: existingFeature, profile } as const
    const { formCopy, onSave } = renderForm(undefined, undefined, mode)
    const distance = screen.getByRole("combobox", { name: copy.distance })
    expect((distance as HTMLInputElement).value).toBe("#depth")
    expect(
      (screen.getByRole("checkbox", { name: copy.symmetric }) as HTMLInputElement).checked,
    ).toBe(true)
    await user.clear(distance)
    await user.type(distance, "24 mm")
    await user.dblClick(screen.getByRole("button", { name: formCopy.submit }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        id: existingFeature.id,
        label: existingFeature.label,
        parameters: expect.objectContaining({
          profile,
          distance: expect.objectContaining({
            value: 24,
            source: expect.objectContaining({ expression: "24 mm" }),
          }),
        }),
      }),
    )
  })

  it("persists an explicit target dependency for a body-modifying operation", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()

    await user.selectOptions(screen.getByRole("combobox", { name: copy.operation }), "remove")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        type: extrusionFeatureType.type,
        parameters: expect.objectContaining({ operation: "remove" }),
        dependencies: ["0195b5ac-b220-7a2c-8c33-67a36a7f3602"],
      }),
    )
  })

  it("persists a stable support reference and dependency for a face-supported sketch", async () => {
    const user = userEvent.setup()
    const mode: ExtrusionFormMode = {
      kind: "create",
      createFeatureId: () => featureId,
      featureLabel: "Extrusion 1",
      profile,
      supportReference,
    }
    const { onSave } = renderForm(undefined, undefined, mode)

    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        dependencies: [supportFeatureId],
        references: [supportReference],
      }),
    )
  })

  it("previews and saves the graphically replacement profile and its support", async () => {
    const user = userEvent.setup()
    const onPreviewChange = vi.fn()
    const mode: ExtrusionFormMode = {
      kind: "edit",
      feature: existingFeature,
      profile: replacementProfile,
      supportReference,
    }
    const { onSave } = renderForm(undefined, undefined, mode, onPreviewChange)

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ profile: replacementProfile }),
          references: [supportReference],
        }),
      ),
    )
    await user.click(screen.getByRole("button", { name: "Update extrusion" }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        parameters: expect.objectContaining({ profile: replacementProfile }),
        dependencies: [supportFeatureId],
        references: [supportReference],
      }),
    )
  })
})
