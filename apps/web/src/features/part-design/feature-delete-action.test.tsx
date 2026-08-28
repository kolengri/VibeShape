// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  boxFeatureType,
  createLengthQuantity,
  type FeatureRecord,
  featureIdSchema,
} from "@vibeshape/domain"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FeatureDeleteAction } from "./feature-delete-action"

const featureIds = {
  box: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4101"),
  dependent: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4102"),
}

const box: FeatureRecord = {
  schemaVersion: 0,
  id: featureIds.box,
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
}

const copy = {
  action: "Delete feature",
  title: "Delete Box 1?",
  description: "This removes the feature from model history.",
  confirm: "Delete feature",
  cancel: "Keep feature",
  failed: "The feature could not be deleted.",
  readOnly: "Open the document with write access to delete features.",
} as const

const preserveIntent = {
  action: "Delete and preserve repair intent",
  title: "Delete Box 1 and preserve repair intent?",
  description: "The listed references will remain available for repair.",
  confirm: "Delete and preserve repair intent",
  affectedReferences: "References that will need repair",
  affectedItems: [{ id: "reference-1", label: "Sketch 1 · Box 1 · Edge 1" }],
  remainingAffectedItems: null,
  failed: "The feature could not be deleted while preserving repair intent.",
} as const

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function renderAction(options: Partial<React.ComponentProps<typeof FeatureDeleteAction>> = {}) {
  const onDeleted = vi.fn()
  const onRemove = vi.fn(async () => ({ ok: true as const }))
  render(
    <FeatureDeleteAction
      baseRevision={5}
      copy={copy}
      blockedReason={null}
      disabled={false}
      feature={box}
      onDeleted={onDeleted}
      onRemove={onRemove}
      {...options}
    />,
  )
  return { onDeleted, onRemove }
}

afterEach(cleanup)

describe("FeatureDeleteAction", () => {
  it("blocks deletion while another feature depends on the target", () => {
    renderAction({ blockedReason: "Deletion is blocked by: Subtract 1 (feature dependency)." })

    expect((screen.getByRole("button", { name: copy.action }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(
      screen.getByText("Deletion is blocked by: Subtract 1 (feature dependency)."),
    ).toBeTruthy()
  })

  it("guards asynchronous double activation and closes only after success", async () => {
    const user = userEvent.setup()
    const operation = deferred<{ ok: true }>()
    const onRemove = vi.fn(() => operation.promise)
    const { onDeleted } = renderAction({ onRemove })

    await user.click(screen.getByRole("button", { name: copy.action }))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: copy.cancel }))
    const confirm = screen.getByRole("button", { name: copy.confirm })
    await user.dblClick(confirm)

    expect(onRemove).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledWith(5, featureIds.box)
    expect(confirm.getAttribute("aria-busy")).toBe("true")
    expect(screen.getByRole("alertdialog")).not.toBeNull()

    operation.resolve({ ok: true })
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("offers a separate guarded preserve-intent action with affected references", async () => {
    const user = userEvent.setup()
    const operation = deferred<{ ok: true }>()
    const onRemovePreservingIntent = vi.fn(() => operation.promise)
    const { onDeleted } = renderAction({
      blockedReason: "Deletion is blocked by: Sketch 1 (model geometry reference).",
      onRemovePreservingIntent,
      preserveIntent,
    })

    expect((screen.getByRole("button", { name: copy.action }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await user.click(screen.getByRole("button", { name: preserveIntent.action }))
    expect(screen.getByText(preserveIntent.affectedReferences)).toBeTruthy()
    expect(screen.getByText(preserveIntent.affectedItems[0].label)).toBeTruthy()
    const confirm = screen.getByRole("button", { name: preserveIntent.confirm })
    await user.dblClick(confirm)

    expect(onRemovePreservingIntent).toHaveBeenCalledOnce()
    expect(onRemovePreservingIntent).toHaveBeenCalledWith(5, featureIds.box)
    expect(confirm.getAttribute("aria-busy")).toBe("true")
    operation.resolve({ ok: true })
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("preserves the confirmation context when deletion fails", async () => {
    const user = userEvent.setup()
    renderAction({
      onRemove: vi.fn(async () => ({
        ok: false as const,
        diagnostic: {
          code: "persistence-failed" as const,
          message: "Delete failed.",
          retryable: true,
          sourceCode: null,
        },
      })),
    })

    await user.click(screen.getByRole("button", { name: copy.action }))
    await user.click(screen.getByRole("button", { name: copy.confirm }))

    expect((await screen.findByText(copy.failed)).textContent).toBe(copy.failed)
    expect(screen.getByRole("alertdialog")).not.toBeNull()
  })

  it("settles the busy state and reports an unexpected rejected removal", async () => {
    const user = userEvent.setup()
    renderAction({
      onRemove: vi.fn(async () => {
        throw new Error("Storage unavailable")
      }),
    })

    await user.click(screen.getByRole("button", { name: copy.action }))
    const confirm = screen.getByRole("button", { name: copy.confirm })
    await user.click(confirm)

    expect((await screen.findByText(copy.failed)).textContent).toBe(copy.failed)
    await waitFor(() => expect(confirm.getAttribute("aria-busy")).toBeNull())
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
  })
})
