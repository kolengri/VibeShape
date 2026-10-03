// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type FeatureRecord, featureIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { i18n } from "../../i18n"
import messages from "../../i18n/messages/en.json"
import {
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../../test-support/authored-tree-fixture"
import { type BodyCombinationCopy, BodyCombinationForm } from "./body-combination-form"
import type {
  BodyCombinationInput,
  BodyCombinationKind,
  BodyCombinationMode,
} from "./body-combination-model"

function setup(
  operation: BodyCombinationKind = "compound",
  onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({ ok: true as const })),
) {
  const { authority } = authoredTreeFixture()
  const options: BodyCombinationInput[] = authority.parts.map((part) => ({
    partId: part.id,
    name: part.name,
    body: requireAuthoredFixture(part.bodyHistory[0]),
  }))
  const featureId = featureIdSchema.parse(authoredTestId(900))
  const mode: BodyCombinationMode = {
    kind: "create",
    operation,
    initial: [],
    createFeatureId: () => featureId,
    featureLabel: "Combined",
  }
  const text = messages.app.bodyCombination
  const copy: BodyCombinationCopy = {
    ...text,
    title: operation === "compound" ? text.compoundTitle : text.unionTitle,
    description: text.compoundDescription,
    submit: text.create,
    selectPart: (name) => `Add part ${name}`,
    removePart: (name) => `Remove part ${name}`,
    moveUp: (name) => `Move ${name} earlier`,
    moveDown: (name) => `Move ${name} later`,
    survivor: (name) => `${name} survives`,
  }
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  const onPreviewChange = vi.fn()
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <BodyCombinationForm
        baseRevision={authority.revision}
        copy={copy}
        disabled={false}
        mode={mode}
        options={options}
        onCancel={onCancel}
        onSave={onSave}
        onSaved={onSaved}
        onPreviewChange={onPreviewChange}
        previewStatus="ready"
      />
    </I18nProvider>,
  )
  return {
    onSave,
    onSaved,
    onCancel,
    onPreviewChange,
    options,
    featureId,
    revision: authority.revision,
  }
}
beforeAll(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
)
afterEach(cleanup)
describe("Compound and Union form", () => {
  it("requires explicit selection and submits ordered exact bodies in one command", async () => {
    const state = setup()
    await userEvent.click(screen.getByRole("button", { name: "Create" }))
    expect(state.onSave).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain(
      messages.app.bodyCombination.invalidSelection,
    )
    await userEvent.click(screen.getByRole("button", { name: "Add part Part 1" }))
    await userEvent.click(screen.getByRole("button", { name: "Add part Part 2" }))
    await userEvent.click(screen.getByRole("button", { name: "Move Part 2 earlier" }))
    await userEvent.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(state.onSaved).toHaveBeenCalledOnce())
    expect(state.onSave).toHaveBeenCalledOnce()
    const [revision, feature] = requireAuthoredFixture(state.onSave.mock.calls[0])
    expect(revision).toBe(state.revision)
    expect(feature.dependencies).toEqual(
      state.options
        .slice(0, 2)
        .reverse()
        .map(({ body }) => body.featureId),
    )
    expect(feature.parameters.slots).toMatchObject(
      state.options
        .slice(0, 2)
        .reverse()
        .map(({ body }) => ({ targetBody: body })),
    )
  })
  it("announces the first Union survivor and preserves selections after storage rejects", async () => {
    const onSave = vi.fn(
      async (_revision: number, _feature: FeatureRecord): Promise<{ ok: true }> => {
        throw new Error("Storage unavailable")
      },
    )
    const state = setup("union", onSave)
    await userEvent.click(screen.getByRole("button", { name: "Add part Part 1" }))
    await userEvent.click(screen.getByRole("button", { name: "Add part Part 2" }))
    expect(screen.getByRole("status").textContent).toBe("Part 1 survives")
    await userEvent.click(screen.getByRole("button", { name: "Move Part 2 earlier" }))
    expect(screen.getByRole("status").textContent).toBe("Part 2 survives")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        messages.app.bodyCombination.saveFailed,
      ),
    )
    expect(screen.getByRole("button", { name: "Remove part Part 2" })).toBeTruthy()
    expect(state.onSaved).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(state.onCancel).toHaveBeenCalledOnce()
  })
})
