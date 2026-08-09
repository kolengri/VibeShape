// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  extrusionFeatureType,
  featureIdSchema,
  featureRecordSchema,
  sketchProfileSelectorSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ExtrusionForm, type ExtrusionFormMode } from "./extrusion-form"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3601")
const profile = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3211"],
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
) {
  const formCopy = mode.kind === "edit" ? { ...copy, submit: "Update extrusion" } : copy
  render(
    <ExtrusionForm
      baseRevision={4}
      copy={formCopy}
      mode={mode}
      profileLabel="Sketch 1"
      variables={variables}
      onCancel={vi.fn()}
      onSave={onSave}
      onSaved={onSaved}
    />,
  )
  return { formCopy, onSave, onSaved }
}

afterEach(cleanup)

describe("ExtrusionForm", () => {
  it("resolves a variable and guards asynchronous double submission", async () => {
    const user = userEvent.setup()
    const submission = deferred()
    const onSave = vi.fn(async () => {
      await submission.promise
      return { ok: true as const }
    })
    const { onSaved } = renderForm(onSave)
    const distance = screen.getByRole("textbox", { name: copy.distance })
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
    const distance = screen.getByRole("textbox", { name: copy.distance })
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
    const mode = { kind: "edit", feature: existingFeature } as const
    const { formCopy, onSave } = renderForm(undefined, undefined, mode)
    const distance = screen.getByRole("textbox", { name: copy.distance })
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
})
