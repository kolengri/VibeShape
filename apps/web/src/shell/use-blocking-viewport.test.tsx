import "../../../../tests/unit/support/dom"
import { afterEach, expect, it, mock } from "bun:test"
import { cleanup, render } from "@testing-library/react"
import { ActivityProvider, useReportBlockingActivity } from "@vibeshape/ui/components/activity"
import { useBlockingViewport } from "./use-blocking-viewport"

afterEach(cleanup)

it("cancels captured gestures once when overlapping blocking work begins", () => {
  const cancelInteractions = mock(() => {})
  const viewport = { current: { cancelInteractions } }
  function Owner({ active, label }: { active: boolean; label: string }) {
    useReportBlockingActivity(active, label)
    return null
  }
  function Viewport() {
    useBlockingViewport(viewport)
    return null
  }
  const view = (first: boolean, second: boolean) => (
    <ActivityProvider>
      <Viewport />
      <Owner active={first} label="Opening" />
      <Owner active={second} label="Reading" />
    </ActivityProvider>
  )
  const result = render(view(false, false))
  expect(cancelInteractions).not.toHaveBeenCalled()
  result.rerender(view(true, true))
  expect(cancelInteractions).toHaveBeenCalledTimes(1)
  result.rerender(view(false, true))
  expect(cancelInteractions).toHaveBeenCalledTimes(1)
  result.rerender(view(false, false))
  result.rerender(view(true, false))
  expect(cancelInteractions).toHaveBeenCalledTimes(2)
})
