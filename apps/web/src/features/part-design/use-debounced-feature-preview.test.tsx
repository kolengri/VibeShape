// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useDebouncedFeaturePreview } from "./use-debounced-feature-preview"

function PreviewHarness({
  onPreviewChange,
  value,
}: {
  onPreviewChange: (preview: string | null) => void
  value: string
}) {
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: value,
  })
  return null
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("useDebouncedFeaturePreview", () => {
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
