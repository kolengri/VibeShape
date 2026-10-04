// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, sketchEntityIdSchema } from "@vibeshape/domain"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { afterEach, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import { SweepLoftForm } from "./sweep-loft-form"
import type { ProfileOption } from "./sweep-loft-form-model"
import { copy, featureId, id, mode, paths, profiles, snapshot } from "./sweep-loft-test-fixtures"

const save = () =>
  vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const }))
function setup(
  operation: "loft" | "sweep",
  options: {
    status?: "ready" | "loading" | "error"
    onSave?: ReturnType<typeof save>
    profiles?: ProfileOption[]
  } = {},
) {
  const onSave = options.onSave ?? save(),
    onSaved = vi.fn(),
    onCancel = vi.fn(),
    onPreviewChange = vi.fn()
  const view = render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <SweepLoftForm
          baseRevision={7}
          copy={copy}
          mode={mode(operation)}
          snapshot={snapshot}
          profiles={options.profiles ?? profiles}
          paths={paths}
          variables={[]}
          onCancel={onCancel}
          onSave={onSave}
          onSaved={onSaved}
          onPreviewChange={onPreviewChange}
          previewStatus={options.status ?? "ready"}
        />
      </TooltipProvider>
    </I18nProvider>,
  )
  return { ...view, onSave, onSaved, onCancel, onPreviewChange }
}
async function addSection(label: string) {
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Section profile" }),
    screen.getByRole("option", { name: label }),
  )
  await userEvent.click(screen.getByRole("button", { name: "Add section" }))
}
afterEach(cleanup)
describe("Sweep and Loft task forms", () => {
  it("guards incomplete Loft, adds ordered sections, reorders, removes and cancels a disposable preview", async () => {
    const f = setup("loft")
    const apply = screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    await addSection("Sketch 1 · Profile 1")
    expect(apply.disabled).toBe(true)
    await addSection("Sketch 2 · Profile 1")
    expect(apply.disabled).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Move section 2 earlier" }))
    await userEvent.click(screen.getByRole("checkbox", { name: "Ruled loft" }))
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: { sections: [profiles[1]?.selector, profiles[0]?.selector], ruled: true },
        }),
      ),
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Remove section Sketch 1 · Profile 1" }),
    )
    expect(apply.disabled).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(f.onCancel).toHaveBeenCalledOnce()
    expect(f.onSave).not.toHaveBeenCalled()
    f.unmount()
    expect(f.onPreviewChange).toHaveBeenLastCalledWith(null)
  })
  it("requires explicit hole correspondence and preserves track identity when reordering sections", async () => {
    const hollowProfiles = profiles.slice(0, 2).map((profile, index) => {
      const selector = {
        ...profile.selector,
        holeBoundaryEntityIds: [[sketchEntityIdSchema.parse(id(150 + index))]],
      }
      return { ...profile, selector, key: sketchProfileSelectorKey(selector) }
    })
    const f = setup("loft", { profiles: hollowProfiles })
    await addSection("Sketch 1 · Profile 1")
    await addSection("Sketch 2 · Profile 1")
    const apply = screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Add hole track" }))
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Hole track 1 · Section 1" }),
      JSON.stringify([id(150)]),
    )
    expect(apply.disabled).toBe(true)
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Hole track 1 · Section 2" }),
      JSON.stringify([id(151)]),
    )
    expect(apply.disabled).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Move section 2 earlier" }))
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSave).toHaveBeenCalledOnce())
    expect(f.onSave.mock.calls[0]?.[1]).toMatchObject({
      type: { schemaVersion: 2 },
      parameters: {
        sections: [hollowProfiles[1]?.selector, hollowProfiles[0]?.selector],
        holeCorrespondence: [{ sectionBoundaryEntityIds: [[id(151)], [id(150)]] }],
      },
    })
  })
  it("requires explicit Sweep curve selection and direction before one revision-bound Apply", async () => {
    const f = setup("sweep")
    const apply = screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Profile" }),
      profiles[0]?.key ?? "",
    )
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Path sketch" }), id(4))
    await userEvent.click(screen.getByRole("checkbox", { name: "Second line" }))
    await userEvent.click(screen.getByRole("checkbox", { name: "First line" }))
    expect(apply.disabled).toBe(true)
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Path start point" }),
      id(32),
    )
    await waitFor(() =>
      expect(f.onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            path: {
              schemaVersion: 0,
              sketchId: id(4),
              entityIds: [id(41), id(42)],
              startPointId: id(32),
            },
          }),
        }),
      ),
    )
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
    expect(f.onSave).toHaveBeenCalledExactlyOnceWith(
      7,
      expect.objectContaining({ id: featureId, dependencies: [], references: [] }),
    )
  })
  it("locks repeated Apply, retains choices on rejection and releases the lock for retry", async () => {
    let reject: ((error: Error) => void) | undefined
    const onSave = save().mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        }),
    )
    const f = setup("loft", { onSave })
    await addSection("Sketch 1 · Profile 1")
    await addSection("Sketch 2 · Profile 1")
    const apply = screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement
    await userEvent.click(apply)
    await userEvent.click(apply)
    expect(onSave).toHaveBeenCalledOnce()
    expect(apply.disabled).toBe(true)
    reject?.(new Error("Storage unavailable"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy.saveFailed))
    expect(apply.disabled).toBe(false)
    onSave.mockResolvedValue({ ok: true })
    await userEvent.click(apply)
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledOnce())
  })
  it.each(["loading", "error"] as const)(
    "blocks a valid Loft selection while exact preview is %s",
    async (status) => {
      setup("loft", { status })
      await addSection("Sketch 1 · Profile 1")
      await addSection("Sketch 2 · Profile 1")
      expect(
        (screen.getByRole("button", { name: "Apply feature" }) as HTMLButtonElement).disabled,
      ).toBe(true)
      if (status === "error") expect(screen.getByRole("alert").textContent).toBe(copy.previewFailed)
    },
  )
})
