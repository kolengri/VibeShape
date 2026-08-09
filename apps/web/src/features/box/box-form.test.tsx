// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { featureIdSchema, variableIdSchema } from "@vibeshape/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BoxForm } from "./box-form"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2602")
const variableId = variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2601")
const variables = [
  { schemaVersion: 0 as const, id: variableId, name: "width", expression: "24 mm" },
]
const copy = {
  title: "Create box",
  description: "Create a primitive solid.",
  dimensions: "Required dimensions",
  width: "Width",
  depth: "Depth",
  height: "Height",
  centered: "Center on the origin",
  expressionDescription: "Enter a length or #variable.",
  create: "Create box",
  cancel: "Cancel",
  invalidExpression: "Enter a valid expression.",
  invalidDimension: "Expression must resolve to a length.",
  invalidRange: "Enter a positive supported length.",
  validationSummary: "Fix the highlighted dimensions.",
  staleRevision: "The document changed.",
  createFailed: "The box could not be created.",
} as const

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function renderForm(onCreate = vi.fn(async () => ({ ok: true as const })), onCreated = vi.fn()) {
  render(
    <BoxForm
      baseRevision={2}
      variables={variables}
      copy={copy}
      createFeatureId={() => featureId}
      featureLabel="Box 1"
      onCancel={vi.fn()}
      onCreate={onCreate}
      onCreated={onCreated}
    />,
  )
  return { onCreate, onCreated }
}

afterEach(cleanup)

describe("BoxForm", () => {
  it("resolves a document variable and guards asynchronous double submission", async () => {
    const user = userEvent.setup()
    const submission = deferred()
    const onCreate = vi.fn(async () => {
      await submission.promise
      return { ok: true as const }
    })
    const { onCreated } = renderForm(onCreate)

    const width = screen.getByRole("textbox", { name: copy.width })
    await user.clear(width)
    await user.type(width, "#width")
    const create = screen.getByRole("button", { name: copy.create })
    await user.dblClick(create)

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        id: featureId,
        label: "Box 1",
        parameters: expect.objectContaining({
          width: expect.objectContaining({
            value: 24,
            source: expect.objectContaining({ expression: "#width" }),
          }),
        }),
      }),
    )
    expect(create.getAttribute("aria-busy")).toBe("true")

    submission.resolve()
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
  })

  it("preserves invalid raw input and focuses its adjacent error", async () => {
    const user = userEvent.setup()
    const { onCreate } = renderForm()
    const width = screen.getByRole("textbox", { name: copy.width })

    await user.clear(width)
    await user.type(width, "#missing")
    await user.click(screen.getByRole("button", { name: copy.create }))

    expect((await screen.findByText(copy.invalidExpression)).textContent).toBe(
      copy.invalidExpression,
    )
    expect(screen.getByText(copy.validationSummary).textContent).toBe(copy.validationSummary)
    expect((width as HTMLInputElement).value).toBe("#missing")
    expect(document.activeElement).toBe(width)
    expect(onCreate).not.toHaveBeenCalled()
  })
})
