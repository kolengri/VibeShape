import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, renderHook } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ReactNode } from "react"
import { i18n } from "../../i18n"
import { extrusionBodyFixture } from "./extrusion-body-test-fixtures"
import { useExtrusionBodyOptions } from "./use-extrusion-body-options"

afterEach(cleanup)

it("reuses current end-face options while feedback changes and drops stale or unavailable sources", () => {
  const { snapshot, rebuild } = extrusionBodyFixture(undefined, false, "PLANE")
  const { result, rerender } = renderHook(
    ({ source, available }: { source: typeof snapshot; available: boolean }) =>
      useExtrusionBodyOptions(source, rebuild, undefined, available),
    {
      initialProps: { source: snapshot, available: true },
      wrapper: ({ children }: { children: ReactNode }) => (
        <I18nProvider i18n={i18n}>{children}</I18nProvider>
      ),
    },
  )
  const original = result.current
  expect(original).toHaveLength(1)
  expect(original[0]?.faces).toHaveLength(1)
  rerender({ source: snapshot, available: true })
  expect(result.current).toBe(original)
  rerender({ source: snapshot, available: false })
  expect(result.current).toHaveLength(0)
  rerender({ source: { ...snapshot, revision: snapshot.revision + 1 }, available: true })
  expect(result.current[0]?.faces).toHaveLength(0)
  rerender({ source: snapshot, available: true })
  expect(result.current[0]?.faces).toHaveLength(1)
})
