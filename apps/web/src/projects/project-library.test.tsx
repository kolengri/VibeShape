import "../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { ProjectLibrary, type ProjectLibraryState } from "./project-library"

afterEach(cleanup)

it("replaces pending project cards with the loaded empty state or a retryable error", () => {
  const onRetry = vi.fn()
  const element = (library: ProjectLibraryState) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <ProjectLibrary
        activeDocumentId={undefined}
        controller={{ status: "library", saveStatus: "saved", diagnostic: null, report: null }}
        disabled={false}
        duplicatingDocumentId={null}
        library={library}
        onCreate={() => undefined}
        onDeleted={async () => undefined}
        onDuplicate={() => undefined}
        onOpen={() => undefined}
        onPendingDeleteChange={() => undefined}
        onRenamed={() => undefined}
        onRetry={onRetry}
        switchingDocumentId={null}
      />
    </I18nProvider>
  )
  const view = render(element({ status: "loading", projects: [] }))
  expect(screen.getByRole("region", { name: "Local projects" }).getAttribute("aria-busy")).toBe(
    "true",
  )
  expect(screen.getByRole("status").textContent).toContain("Loading")
  expect(screen.queryByRole("button", { name: "New project" })).toBeNull()
  expect(view.container.querySelector('[data-project-skeleton="library"]')).not.toBeNull()

  view.rerender(element({ status: "ready", projects: [] }))
  expect(screen.getByRole("button", { name: "New project" })).toBeTruthy()
  expect(view.container.querySelector("[data-project-skeleton]")).toBeNull()
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull()

  view.rerender(element({ status: "error", projects: [] }))
  expect(screen.getByRole("alert")).toBeTruthy()
  screen.getByRole("button", { name: "Retry" }).click()
  expect(onRetry).toHaveBeenCalledTimes(1)
  expect(view.container.querySelector("[data-project-skeleton]")).toBeNull()
})
