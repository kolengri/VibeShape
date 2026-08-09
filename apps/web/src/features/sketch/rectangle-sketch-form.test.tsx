// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  createRectangleSketch,
  type SketchRecord,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RectangleSketchForm, type RectangleSketchFormMode } from "./rectangle-sketch-form"

const sketchId = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101")
const variableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102")
const variables = [
  { schemaVersion: 0 as const, id: variableId, name: "width", expression: "48 mm" },
]
const copy = {
  title: "Create rectangle sketch",
  description: "Create a constrained rectangular profile.",
  dimensions: "Sketch definition",
  plane: "Support plane",
  planeDescription: "Choose an origin plane.",
  planeXy: "XY plane",
  planeXz: "XZ plane",
  planeYz: "YZ plane",
  width: "Width",
  height: "Height",
  expressionDescription: "Enter a length or #variable.",
  submit: "Create sketch",
  cancel: "Cancel",
  invalidExpression: "Enter a valid expression.",
  invalidDimension: "Expression must resolve to a length.",
  invalidRange: "Enter a positive supported length.",
  validationSummary: "Fix the highlighted dimensions.",
  staleRevision: "The document changed.",
  saveFailed: "The sketch could not be saved.",
} as const

function sequentialIdFactory<T>(parse: (value: string) => T, group: string) {
  let index = 0
  return () => {
    index += 1
    return parse(`0195b5ac-${group}-7a2c-8c33-${index.toString(16).padStart(12, "0")}`)
  }
}

function createMode(): RectangleSketchFormMode {
  return {
    kind: "create",
    sketchLabel: "Sketch 1",
    createSketchId: () => sketchId,
    createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b231"),
    createConstraintId: sequentialIdFactory(
      (value) => sketchConstraintIdSchema.parse(value),
      "b232",
    ),
  }
}

function existingSketch() {
  return createRectangleSketch({
    id: sketchId,
    label: "Sketch 1",
    plane: "xy",
    width: createLengthQuantity(48, "mm", "#width"),
    height: createLengthQuantity(30, "mm", "30 mm"),
    createEntityId: sequentialIdFactory((value) => sketchEntityIdSchema.parse(value), "b233"),
    createConstraintId: sequentialIdFactory(
      (value) => sketchConstraintIdSchema.parse(value),
      "b234",
    ),
  })
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function renderForm(
  mode: RectangleSketchFormMode = createMode(),
  onSave = vi.fn(async (_baseRevision: number, _sketch: SketchRecord) => ({ ok: true as const })),
  onSaved = vi.fn(),
  onPreview = vi.fn(),
) {
  render(
    <RectangleSketchForm
      baseRevision={4}
      copy={copy}
      mode={mode}
      variables={variables}
      onCancel={vi.fn()}
      onPreview={onPreview}
      onSave={onSave}
      onSaved={onSaved}
    />,
  )
  return { onPreview, onSave, onSaved }
}

afterEach(cleanup)

describe("RectangleSketchForm", () => {
  it("preserves variable expressions, publishes a preview, and guards double submission", async () => {
    const user = userEvent.setup()
    const submission = deferred()
    const onSave = vi.fn(async () => {
      await submission.promise
      return { ok: true as const }
    })
    const { onPreview, onSaved } = renderForm(createMode(), onSave)
    const width = screen.getByRole("textbox", { name: copy.width })
    await user.clear(width)
    await user.type(width, "#width")
    await user.selectOptions(screen.getByRole("combobox", { name: copy.plane }), "yz")

    await waitFor(() =>
      expect(onPreview).toHaveBeenLastCalledWith({ width: 48, height: 30, plane: "yz" }),
    )
    const submit = screen.getByRole("button", { name: copy.submit })
    await user.dblClick(submit)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        id: sketchId,
        plane: "yz",
        constraints: expect.arrayContaining([
          expect.objectContaining({
            type: "horizontal-distance",
            value: expect.objectContaining({
              source: expect.objectContaining({ expression: "#width" }),
            }),
          }),
        ]),
      }),
    )
    expect(submit.getAttribute("aria-busy")).toBe("true")
    submission.resolve()
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it("preserves invalid input and focuses the first invalid dimension", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()
    const width = screen.getByRole("textbox", { name: copy.width })
    await user.clear(width)
    await user.type(width, "#missing")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(await screen.findByText(copy.invalidExpression)).toBeTruthy()
    expect(screen.getByText(copy.validationSummary)).toBeTruthy()
    expect((width as HTMLInputElement).value).toBe("#missing")
    expect(document.activeElement).toBe(width)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("updates a compatible rectangle without replacing stable identities", async () => {
    const user = userEvent.setup()
    const sketch = existingSketch()
    const onSave = vi.fn(async (_baseRevision: number, _sketch: SketchRecord) => ({
      ok: true as const,
    }))
    renderForm({ kind: "edit", sketch }, onSave)
    expect((screen.getByRole("textbox", { name: copy.width }) as HTMLInputElement).value).toBe(
      "#width",
    )
    const height = screen.getByRole("textbox", { name: copy.height })
    await user.clear(height)
    await user.type(height, "20 mm")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const updated = onSave.mock.calls[0]?.[1]
    expect(updated?.id).toBe(sketch.id)
    expect(updated?.entities.map(({ id }) => id)).toEqual(sketch.entities.map(({ id }) => id))
    expect(updated?.constraints.map(({ id }) => id)).toEqual(sketch.constraints.map(({ id }) => id))
  })
})
