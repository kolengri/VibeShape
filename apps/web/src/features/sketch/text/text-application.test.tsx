import "../../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../../document/document-controller"

import type { EditorSessionStoreApi } from "../../../editor-session/editor-session-store"

const font = (() => ({ load: vi.fn() }))()
const originalModule1 = { ...(await import("./text-font")) }
mock.module("./text-font", () => ({
  ...originalModule1,
  loadSketchTextFont: font.load,
}))

const { webcrypto } = await import("node:crypto")
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
)
const { default: userEvent } = await import("@testing-library/user-event")
const { sketchRecordSchema } = await import("@vibeshape/domain")
const { moveSketchPoint } = await import("@vibeshape/domain/sketch-edit")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { useEffect } = await import("react")
const { EditorSessionProvider, useEditorSession, useEditorSessionStoreApi } = await import(
  "../../../editor-session/editor-session-provider"
)
const { i18n } = await import("../../../i18n")
const { default: messages } = await import("../../../i18n/messages/en.json")
const { useSketchTextApplication } = await import("./text-application")
const { SketchTextActionsProvider } = await import("./text-context")
const { SketchTextDialog } = await import("./text-dialog")
const { SketchTextFontError } = await import("./text-font")
const { SketchTextGroups } = await import("./text-groups")
const { authoredTextSketch, emptyTextSketch, fontBytes, requireTextGroup, textId } = await import(
  "./text-test-fixtures"
)
const controller = {
  status: "ready",
  saveStatus: "saved",
  report: { mode: "read-write" },
} as unknown as DocumentControllerState
function setup(initial = emptyTextSketch(), state = controller) {
  let captured: EditorSessionStoreApi | undefined
  function View({ current }: { current: DocumentControllerState }) {
    const store = useEditorSessionStoreApi()
    const draft = useEditorSession((session) => session.sketch.draft)
    const text = useSketchTextApplication(current)
    useEffect(() => {
      store.getState().actions.beginSketchEdit(initial)
      captured = store
    }, [store])
    return (
      <SketchTextActionsProvider actions={text.actions}>
        {draft && (
          <SketchTextGroups draft={draft} disabled={current.report?.mode !== "read-write"} />
        )}
        <SketchTextDialog
          target={text.target}
          getDraft={text.getDraft}
          onDraftChange={text.commitDraft}
          onClose={text.close}
        />
      </SketchTextActionsProvider>
    )
  }
  const tree = (current: DocumentControllerState) => (
    <I18nProvider i18n={i18n}>
      <EditorSessionProvider>
        <View current={current} />
      </EditorSessionProvider>
    </I18nProvider>
  )
  const view = render(tree(state))
  return {
    store: () => {
      if (!captured) throw new Error("The text test requires an editor session.")
      return captured
    },
    draft: () => {
      const draft = captured?.getState().sketch.draft
      if (!draft) throw new Error("The text test requires an active draft.")
      return draft
    },
    update: (next: DocumentControllerState) => view.rerender(tree(next)),
  }
}
async function openText(text = "O") {
  await userEvent.click(screen.getByRole("button", { name: "Add text" }))
  const dialog = screen.getByRole("dialog")
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Text" }), {
    target: { value: text },
  })
  return dialog
}
async function applyText(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole("button", { name: "Apply text" }))
  // Keep retries cheap: Bun eagerly formats a received DOM node and its React owner graph.
  await waitFor(() => expect(screen.queryByRole("dialog") === null).toBe(true))
}
beforeEach(() => {
  font.load.mockReset().mockResolvedValue(fontBytes)
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto })
})
afterEach(cleanup)

describe("editable sketch text application", () => {
  it("publishes one draft undo step and detaches metadata while retaining usable curves", async () => {
    const view = setup()
    const dialog = await openText()
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Origin X (mm)" }), {
      target: { value: "15" },
    })
    await applyText(dialog)
    const authored = view.draft()
    const group = requireTextGroup(authored)
    expect(group.origin).toEqual([15, 0])
    expect(group.parameters).toMatchObject({ text: "O", heightMm: 10, kerning: true })
    act(() => view.store().getState().actions.undoSketchDraft())
    expect(view.draft().entities).toEqual([])
    act(() => view.store().getState().actions.redoSketchDraft())
    expect(view.draft()).toEqual(authored)
    await userEvent.click(screen.getByRole("button", { name: "Detach text O" }))
    expect(view.draft().entities).toEqual(authored.entities)
    expect(view.draft().textGroups).toEqual([])
    act(() => view.store().getState().actions.undoSketchDraft())
    expect(view.draft()).toEqual(authored)
  })
  it("cancels both idle and pending generation without authoring a single entity", async () => {
    const view = setup()
    let dialog = await openText()
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(view.draft()).toEqual(emptyTextSketch())
    let resolve: ((bytes: Uint8Array) => void) | undefined
    font.load.mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((done) => {
          resolve = done
        }),
    )
    dialog = await openText()
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply text" }))
    expect(
      within(dialog)
        .getByRole("group", { name: "Sketch text parameters" })
        .getAttribute("aria-busy"),
    ).toBe("true")
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await act(async () => {
      resolve?.(fontBytes)
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(view.draft()).toEqual(emptyTextSketch())
    act(() => view.store().getState().actions.undoSketchDraft())
    expect(view.draft()).toEqual(emptyTextSketch())
  })
  it("blocks duplicate submits, exposes rejected font loading and releases Apply for retry", async () => {
    const view = setup()
    let reject: ((error: Error) => void) | undefined
    font.load.mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail
        }),
    )
    const dialog = await openText()
    const form = within(dialog).getByRole("form", { name: "Add sketch text" })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(font.load).toHaveBeenCalledTimes(1)
    expect(
      (within(dialog).getByRole("button", { name: "Apply text" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await act(async () => reject?.(new SketchTextFontError("Unavailable")))
    expect(within(dialog).getByRole("alert").textContent).toBe(messages.app.sketchText.fontFailed)
    expect(view.draft().entities).toEqual([])
    await applyText(dialog)
    expect(font.load).toHaveBeenCalledTimes(2)
    expect(view.draft().textGroups).toHaveLength(1)
  })
  it("shows field and missing-glyph errors without changing the draft", async () => {
    const view = setup()
    const dialog = await openText("💡")
    const height = within(dialog).getByRole("spinbutton", { name: "Capital height (mm)" })
    fireEvent.change(height, { target: { value: "0" } })
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply text" }))
    expect(within(dialog).getByText(messages.app.sketchText.invalidHeight)).toBeTruthy()
    expect(font.load).not.toHaveBeenCalled()
    fireEvent.change(height, { target: { value: "10" } })
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply text" }))
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("U+1F4A1"))
    expect(view.draft().entities).toEqual([])
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Text" }), {
      target: { value: "O" },
    })
    await applyText(dialog)
    expect(requireTextGroup(view.draft()).parameters.text).toBe("O")
  })
  it("loads original intent, warns about altered outlines and regenerates only on Apply", async () => {
    const authored = await authoredTextSketch()
    const group = requireTextGroup(authored)
    const point = group.pointIds[0]
    if (!point) throw new Error("Expected a text contour point.")
    const altered = moveSketchPoint(authored, point, { x: 40, y: -10 })
    const view = setup(altered)
    await userEvent.click(screen.getByRole("button", { name: "Edit text O" }))
    let dialog = screen.getByRole("dialog")
    await waitFor(() =>
      expect(within(dialog).getByText(messages.app.sketchText.alteredOutline)).toBeTruthy(),
    )
    expect(
      (within(dialog).getByRole("spinbutton", { name: "Origin X (mm)" }) as HTMLInputElement).value,
    ).toBe("12")
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Text" }), {
      target: { value: "C" },
    })
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(view.draft()).toEqual(altered)
    await userEvent.click(screen.getByRole("button", { name: "Edit text O" }))
    dialog = screen.getByRole("dialog")
    await waitFor(() =>
      expect(within(dialog).queryByText(messages.app.sketchText.checkingOutline)).toBeNull(),
    )
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Text" }), {
      target: { value: "C" },
    })
    await applyText(dialog)
    expect(requireTextGroup(view.draft())).toMatchObject({
      id: group.id,
      parameters: { text: "C" },
    })
    expect(view.draft().entities.some(({ id }) => group.curveIds.includes(id))).toBe(false)
    act(() => view.store().getState().actions.undoSketchDraft())
    expect(view.draft()).toEqual(altered)
  })
  it("requires explicit attached-constraint removal and preserves unrelated constraints", async () => {
    const authored = await authoredTextSketch()
    const group = requireTextGroup(authored)
    const pointId = group.pointIds[0]
    if (!pointId) throw new Error("Expected a text point.")
    const constrained = sketchRecordSchema.parse({
      ...authored,
      entities: [
        ...authored.entities,
        { schemaVersion: 0, id: textId(5000), type: "point", x: 80, y: 80 },
      ],
      constraints: [
        { schemaVersion: 0, id: textId(5001), type: "fixed", pointId },
        { schemaVersion: 0, id: textId(5002), type: "fixed", pointId: textId(5000) },
      ],
    })
    const view = setup(constrained)
    await userEvent.click(screen.getByRole("button", { name: "Edit text O" }))
    const dialog = screen.getByRole("dialog")
    await waitFor(() =>
      expect(within(dialog).queryByText(messages.app.sketchText.checkingOutline)).toBeNull(),
    )
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply text" }))
    expect(within(dialog).getByRole("alert").textContent).toBe(
      messages.app.sketchText.constraintsRequired,
    )
    expect(font.load).not.toHaveBeenCalled()
    expect(view.draft()).toEqual(constrained)
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: messages.app.sketchText.removeConstraints }),
    )
    await applyText(dialog)
    expect(view.draft().constraints).toEqual<unknown>([constrained.constraints[1]])
    act(() => view.store().getState().actions.undoSketchDraft())
    expect(view.draft()).toEqual(constrained)
  })
  it("rejects a changed live draft after asynchronous work and closes on lost editing authority", async () => {
    const view = setup()
    let resolve: ((bytes: Uint8Array) => void) | undefined
    font.load.mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((done) => {
          resolve = done
        }),
    )
    const dialog = await openText()
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply text" }))
    const changed = { ...view.draft(), label: "Changed during preparation" }
    act(() => view.store().getState().actions.setSketchDraft(changed))
    await act(async () => {
      resolve?.(fontBytes)
    })
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe(
        messages.app.sketchText.draftChanged,
      ),
    )
    expect(view.draft()).toEqual(changed)
    view.update({ ...controller, saveStatus: "saving" })
    expect(screen.queryByRole("dialog")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Add text" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
