// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createAngleQuantity,
  type FeatureId,
  featureIdSchema,
  featureRecordSchema,
  type revolveFeatureParametersSchema,
  revolveFeatureType,
  sketchEntityIdSchema,
  sketchProfileSelectorSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { RevolveForm, type RevolveFormMode } from "./revolve-form"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3701")
const profile = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3211"],
  holeBoundaryEntityIds: [],
})
const variables = [
  {
    schemaVersion: 0 as const,
    id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2701"),
    name: "sweep",
    expression: "180 deg",
  },
]
const copy = {
  title: "Revolve profile",
  description: "Create a new solid.",
  parameters: "Revolve parameters",
  profile: "Selected profile",
  axis: "Revolve axis",
  axisX: "Horizontal sketch axis (X)",
  axisY: "Vertical sketch axis (Y)",
  axisSelectHint: "Select a line in the viewport.",
  angle: "Angle",
  expressionDescription: "Enter an angle or #variable.",
  submit: "Create revolve",
  cancel: "Cancel",
  invalidExpression: "Enter a valid expression.",
  invalidDimension: "Expression must resolve to an angle.",
  invalidRange: "Enter a supported positive angle.",
  validationSummary: "Fix the highlighted angle.",
  staleRevision: "The document changed.",
  saveFailed: "The revolve could not be created.",
  operation: "Result operation",
  operationNew: "New body",
  operationAdd: "Add to body",
  operationRemove: "Remove from body",
  operationIntersect: "Intersect with body",
  target: "Target body",
  targetDescription: "Choose a target body.",
  missingTarget: "Choose a target.",
} as const

const existingFeature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: revolveFeatureType.type,
  parameters: {
    profile,
    axis: { kind: "origin-axis", axis: "y" },
    angle: createAngleQuantity(180, "deg", "#sweep"),
    operation: "new",
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Revolve 1",
})

const targetFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3702")

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
  mode: RevolveFormMode = {
    kind: "create",
    createFeatureId: () => featureId,
    featureLabel: "Revolve 1",
    profile,
  },
  onPreviewChange = vi.fn(),
  options: readonly { id: FeatureId; label: string }[] = [],
  axisSelection?: ReturnType<typeof revolveFeatureParametersSchema.parse>["axis"],
) {
  const formCopy = mode.kind === "edit" ? { ...copy, submit: "Update revolve" } : copy
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <RevolveForm
          {...(axisSelection ? { axisLineLabel: "Sketch 1 · Line 1", axisSelection } : {})}
          baseRevision={4}
          copy={formCopy}
          mode={mode}
          options={options}
          profileLabel="Sketch 1"
          variables={variables}
          onCancel={vi.fn()}
          onPreviewChange={onPreviewChange}
          onSave={onSave}
          onSaved={onSaved}
        />
      </TooltipProvider>
    </I18nProvider>,
  )
  return { formCopy, onPreviewChange, onSave, onSaved }
}

afterEach(cleanup)

describe("RevolveForm", () => {
  it("publishes a 360 degree preview by default and follows axis changes", async () => {
    const user = userEvent.setup()
    const { onPreviewChange, onSave } = renderForm()

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenCalledWith(
        expect.objectContaining({
          id: featureId,
          parameters: expect.objectContaining({
            axis: { kind: "origin-axis", axis: "x" },
            angle: expect.objectContaining({ value: Math.PI * 2 }),
          }),
        }),
      ),
    )
    await user.click(screen.getByRole("button", { name: copy.axisY }))
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ axis: { kind: "origin-axis", axis: "y" } }),
        }),
      ),
    )
    expect(onSave).not.toHaveBeenCalled()
  })

  it("accepts a graphical stable sketch-line axis from the viewport", async () => {
    const onPreviewChange = vi.fn()
    const axisSelection = {
      kind: "sketch-line" as const,
      sketchId: profile.sketchId,
      entityId: sketchEntityIdSchema.parse(profile.outerBoundaryEntityIds[0]),
    }
    renderForm(undefined, undefined, undefined, onPreviewChange, [], axisSelection)

    expect(screen.getByText("Sketch 1 · Line 1")).toBeTruthy()
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ axis: axisSelection }),
        }),
      ),
    )
  })

  it("resolves a variable and prevents duplicate asynchronous submission", async () => {
    const user = userEvent.setup()
    const submission = deferred()
    const onSave = vi.fn(async () => {
      await submission.promise
      return { ok: true as const }
    })
    const { onSaved } = renderForm(onSave)
    const angle = screen.getByRole("combobox", { name: copy.angle })
    await user.clear(angle)
    await user.type(angle, "#sweep")
    const create = screen.getByRole("button", { name: copy.submit })
    await user.dblClick(create)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        id: featureId,
        parameters: expect.objectContaining({
          angle: expect.objectContaining({
            value: Math.PI,
            source: expect.objectContaining({ expression: "#sweep" }),
          }),
        }),
      }),
    )
    expect(create.getAttribute("aria-busy")).toBe("true")
    submission.resolve()
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it("preserves and focuses invalid raw input", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()
    const angle = screen.getByRole("combobox", { name: copy.angle })
    await user.clear(angle)
    await user.type(angle, "#missing")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(await screen.findByText(copy.invalidExpression)).toBeTruthy()
    expect((angle as HTMLInputElement).value).toBe("#missing")
    expect(document.activeElement).toBe(angle)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("restores the source expression and updates the existing identity", async () => {
    const user = userEvent.setup()
    const mode = { kind: "edit", feature: existingFeature } as const
    const { formCopy, onSave } = renderForm(undefined, undefined, mode)
    const angle = screen.getByRole("combobox", { name: copy.angle })
    expect((angle as HTMLInputElement).value).toBe("#sweep")
    expect(screen.getByRole("button", { name: copy.axisY }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    await user.clear(angle)
    await user.type(angle, "90 deg")
    await user.dblClick(screen.getByRole("button", { name: formCopy.submit }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        id: existingFeature.id,
        label: existingFeature.label,
        parameters: expect.objectContaining({
          axis: { kind: "origin-axis", axis: "y" },
          angle: expect.objectContaining({
            value: Math.PI / 2,
            source: expect.objectContaining({ expression: "90 deg" }),
          }),
        }),
      }),
    )
  })

  it("publishes the selected modifying operation and target first in dependencies", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm(
      vi.fn(async () => ({ ok: true as const })),
      undefined,
      undefined,
      vi.fn(),
      [{ id: targetFeatureId, label: "Box 1" }],
    )
    await user.selectOptions(screen.getByRole("combobox", { name: copy.operation }), "add")
    expect(screen.getByRole("combobox", { name: copy.target })).toBeTruthy()
    await user.selectOptions(screen.getByRole("combobox", { name: copy.target }), targetFeatureId)
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        dependencies: [targetFeatureId],
        parameters: expect.objectContaining({ operation: "add" }),
      }),
    )
  })

  it("blocks a modifying operation until a target is available", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()

    await user.selectOptions(screen.getByRole("combobox", { name: copy.operation }), "remove")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    const target = screen.getByRole("combobox", { name: copy.target }) as HTMLSelectElement
    expect(screen.getByText(copy.missingTarget)).toBeTruthy()
    expect(target.required).toBe(true)
    expect(target.checkValidity()).toBe(false)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("restores a modifying operation and target while editing", () => {
    const modifyingFeature = featureRecordSchema.parse({
      ...existingFeature,
      parameters: { ...existingFeature.parameters, operation: "intersect" },
      dependencies: [targetFeatureId],
    })

    renderForm(undefined, undefined, { kind: "edit", feature: modifyingFeature }, undefined, [
      { id: targetFeatureId, label: "Box 1" },
    ])

    expect(
      (screen.getByRole("combobox", { name: copy.operation }) as HTMLSelectElement).value,
    ).toBe("intersect")
    expect((screen.getByRole("combobox", { name: copy.target }) as HTMLSelectElement).value).toBe(
      targetFeatureId,
    )
  })
})
