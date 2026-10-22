import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  ActivityProvider,
  useBlockingActivity,
  useReportBlockingActivity,
} from "@vibeshape/ui/components/activity"
import { BlockingLoader } from "@vibeshape/ui/components/blocking-loader"
import { useTexturePanelKeyboard } from "./use-texture-panel-actions"

afterEach(cleanup)

it("pauses capture-phase mask undo and gallery shortcuts while blocking work owns the interface", () => {
  const undo = mock(() => {})
  const gallery = mock((_value: boolean) => {})
  const state = { maskUndoAvailable: true, strokeActive: false, undoMask: undo }
  function Editor({ blocking }: { blocking: boolean }) {
    useTexturePanelKeyboard(true, gallery, state)
    useReportBlockingActivity(blocking, "Closing project")
    return <BlockingLoader label={useBlockingActivity()} />
  }
  const view = (blocking: boolean) => (
    <ActivityProvider>
      <Editor blocking={blocking} />
    </ActivityProvider>
  )
  const result = render(view(false))
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true })
  expect(undo).toHaveBeenCalledTimes(1)
  result.rerender(view(true))
  const dialog = screen.getByRole("dialog", { name: "Closing project" })
  fireEvent.keyDown(dialog, { key: "z", ctrlKey: true })
  fireEvent.keyDown(dialog, { key: "Escape" })
  expect(undo).toHaveBeenCalledTimes(1)
  expect(gallery).not.toHaveBeenCalled()
  result.rerender(view(false))
  fireEvent.keyDown(document.body, { key: "z", metaKey: true })
  fireEvent.keyDown(document.body, { key: "Escape" })
  expect(undo).toHaveBeenCalledTimes(2)
  expect(gallery).toHaveBeenCalledWith(false)
})
