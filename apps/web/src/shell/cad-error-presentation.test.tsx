import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { documentSnapshotSchema } from "@vibeshape/domain"
import { modelDiagnosticEntrySchema } from "@vibeshape/domain/model-diagnostics"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { i18n } from "../i18n"
import { CadErrorPresentation, cadErrorKind } from "./cad-error-presentation"

const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: "0195b5ac-b213-7f2c-9c33-67a36a7f2101",
  revision: 4,
  name: "Diagnostic test",
  createdAt: "2026-08-16T00:00:00Z",
  updatedAt: "2026-08-16T00:00:00Z",
  features: [],
})
const entry = (code: string, values = {}) =>
  modelDiagnosticEntrySchema.parse({
    entity: { kind: "feature", id: featureId },
    code,
    values,
    action: "inspect-feature",
  })
afterEach(cleanup)

function show(diagnostic: ReturnType<typeof entry>) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <CadErrorPresentation diagnostics={[diagnostic]} snapshot={snapshot} />
    </I18nProvider>,
  )
}

describe("CAD error presentation", () => {
  it("explains a missing profile and the concrete recovery next to the operation", () => {
    show(entry("org.vibeshape.feature.sketch-profile-missing", { reason: "empty-profile-set" }))
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("The selected sketch profile no longer exists.")
    expect(alert.textContent).toContain(
      "Restore a closed region in the sketch, or select another profile.",
    )
    expect(screen.getAllByRole("alert")).toHaveLength(1)
  })

  it("distinguishes an unreachable extrusion end from missing sketch support", () => {
    const diagnostic = entry("org.vibeshape.feature.sketch-support-missing", {
      reason: "extrusion-end-support-stale-or-unreachable",
    })
    expect(cadErrorKind(diagnostic)).toBe("endCondition")
    show(diagnostic)
    expect(screen.getByRole("alert").textContent).toContain("change the end condition to Distance")
  })

  it("keeps an unknown code and complete long original diagnostic behind a keyboard disclosure", async () => {
    const original = `Exact kernel failure ${"unbrokenContext".repeat(500)}`
    show(
      entry("org.vibeshape.future.kernel-failure", {
        message: original,
        reason: "unknown-exact-cause",
      }),
    )
    expect(screen.getByRole("alert").textContent).toContain("The operation could not be evaluated.")
    const disclosure = screen.getByText("Technical details")
    expect(disclosure.closest("details")?.open).toBe(false)
    disclosure.focus()
    await userEvent.keyboard("{Enter}")
    // Native details activation is provided by the browser; the original payload stays intact.
    expect(screen.getByText(/Exact kernel failure/, { selector: "pre" }).textContent).toContain(
      original,
    )
    expect(screen.getByText(/Exact kernel failure/, { selector: "pre" }).textContent).toContain(
      "org.vibeshape.future.kernel-failure",
    )
    expect(document.activeElement).toBe(disclosure)
  })

  it("identifies dependency failure without guessing a geometry cause", () => {
    expect(cadErrorKind(entry("org.vibeshape.feature.dependency-blocked"))).toBe(
      "dependencyBlocked",
    )
    expect(
      cadErrorKind(
        entry("org.vibeshape.feature.geometry-evaluation-failed", {
          reason: "missing-feature-dependency",
        }),
      ),
    ).toBe("bodyMissing")
    expect(
      cadErrorKind(
        entry("org.vibeshape.feature.geometry-evaluation-failed", {
          reason: "invalid-feature-geometry",
        }),
      ),
    ).toBe("unknown")
  })
})
