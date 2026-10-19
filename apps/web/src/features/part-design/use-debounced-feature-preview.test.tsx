import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { act, cleanup, render } from "@testing-library/react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { useDebouncedFeaturePreview } from "./use-debounced-feature-preview"

function PreviewHarness({
  onPreviewChange,
  value,
  retainValidPreview = false,
}: {
  onPreviewChange: (preview: string | null) => void
  value: string | null
  retainValidPreview?: boolean
}) {
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: value,
    retainValidPreview,
  })
  return null
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("useDebouncedFeaturePreview", () => {
  it("retains a valid Placement preview during debounce but clears invalid input and unmount", async () => {
    vi.useFakeTimers()
    const onPreviewChange = vi.fn()
    const view = render(
      <PreviewHarness onPreviewChange={onPreviewChange} value="first" retainValidPreview />,
    )
    await act(() => vi.advanceTimersByTimeAsync(180))
    expect(onPreviewChange).toHaveBeenLastCalledWith("first")
    view.rerender(
      <PreviewHarness onPreviewChange={onPreviewChange} value="second" retainValidPreview />,
    )
    expect(onPreviewChange).toHaveBeenLastCalledWith("first")
    await act(() => vi.advanceTimersByTimeAsync(180))
    expect(onPreviewChange).toHaveBeenLastCalledWith("second")
    view.rerender(
      <PreviewHarness onPreviewChange={onPreviewChange} value={null} retainValidPreview />,
    )
    expect(onPreviewChange).toHaveBeenLastCalledWith(null)
    view.unmount()
    expect(onPreviewChange).toHaveBeenLastCalledWith(null)
  })
  it("invalidates the confirmed preview before debouncing the next candidate", async () => {
    vi.useFakeTimers()
    const onPreviewChange = vi.fn()
    const view = render(<PreviewHarness onPreviewChange={onPreviewChange} value="first" />)

    expect(onPreviewChange).toHaveBeenLastCalledWith(null)
    await act(() => vi.advanceTimersByTimeAsync(180))
    expect(onPreviewChange).toHaveBeenLastCalledWith("first")

    view.rerender(<PreviewHarness onPreviewChange={onPreviewChange} value="second" />)
    expect(onPreviewChange).toHaveBeenLastCalledWith(null)
    await act(() => vi.advanceTimersByTimeAsync(180))
    expect(onPreviewChange).toHaveBeenLastCalledWith("second")
  })

  it("publishes only the latest candidate during rapid changes", async () => {
    vi.useFakeTimers()
    const onPreviewChange = vi.fn()
    const view = render(<PreviewHarness onPreviewChange={onPreviewChange} value="first" />)

    view.rerender(<PreviewHarness onPreviewChange={onPreviewChange} value="second" />)
    await act(() => vi.advanceTimersByTimeAsync(180))

    expect(onPreviewChange).not.toHaveBeenCalledWith("first")
    expect(onPreviewChange).toHaveBeenLastCalledWith("second")
  })
})
