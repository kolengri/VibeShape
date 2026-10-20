import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { assemblyFrameBindingSchema } from "@vibeshape/domain/assembly-mates"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { assemblyInspectionSchema, topologyCandidateSchema } from "@vibeshape/protocol"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { AssemblyFrameBindingFields } from "./assembly-frame-binding-fields"
import { identityAssemblyPose } from "./assembly-model"
import { assemblyUiFixture } from "./assembly-test-fixture"

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function fixture() {
  const f = assemblyUiFixture()
  const body = f.definition.pinnedModels[0]?.selectedBody
  if (!body) throw new Error("Expected pinned body fixture.")
  const candidate = topologyCandidateSchema.parse({
    candidateId: "face:1",
    kind: "face",
    lineageTokens: [],
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 1,
      centroid: [0, 0, 0],
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      boundaryCount: 4,
      adjacentGeometryClasses: [],
    },
    referenceGeometry: { kind: "plane-face", origin: [0, 0, 0], normal: [0, 0, 1] },
  })
  const binding = assemblyFrameBindingSchema.parse({
    sourceIndex: 0,
    pinRevision: 1,
    body,
    reference: {
      schemaVersion: 0,
      featureId: body.featureId,
      kind: "face",
      signature: candidate.signature,
    },
    geometry: "planar-face",
    originHint: [0, 0, 0],
    xDirection: [1, 0, 0],
    reversed: false,
  })
  const assembly = { ...f.assembly, definitions: [{ ...f.definition, pinRevision: 2 }] }
  const inspection = assemblyInspectionSchema.parse({
    occurrences: [
      {
        instanceId: f.parent.id,
        definitionId: f.definition.id,
        pinRevision: 2,
        sourceIndex: 0,
        selectedBody: body,
        contentHash: "a".repeat(64),
        representation: "exact-solid",
        geometryFrame: identityAssemblyPose,
        topologyCandidates: [candidate],
        mesh: {
          positions: new Float32Array(),
          normals: new Float32Array(),
          indices: new Uint32Array(),
          triangleFaceIds: new Uint32Array(),
        },
        bounds: candidate.signature.bounds,
      },
    ],
    interference: [],
  })
  return { f, body, binding, assembly, inspection }
}
describe("saved frame binding identity", () => {
  it.each(["pin", "body"] as const)(
    "surfaces an unchanged shape with stale %s as unresolved until deliberate reselection",
    async (stale) => {
      const f = fixture()
      if (stale === "body") {
        f.binding.pinRevision = 2
        f.binding.body.outputRole = "other"
      }
      const onChange = vi.fn()
      render(
        <I18nProvider i18n={i18n} initialLocale="en">
          <AssemblyFrameBindingFields
            prefix="child"
            assembly={f.assembly}
            inspection={f.inspection}
            instanceId={f.f.parent.id}
            binding={f.binding}
            onChange={onChange}
          />
        </I18nProvider>,
      )
      const control = screen.getByRole("combobox", { name: "Child frame geometry" })
      expect(control.textContent).toContain("Unresolved saved reference")
      expect(onChange).not.toHaveBeenCalled()
      await userEvent.click(control)
      await userEvent.type(screen.getByRole("combobox", { name: "Search options…" }), "PLANE")
      await userEvent.click(screen.getByRole("option", { name: /PLANE/ }))
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ pinRevision: 2, body: f.body, sourceIndex: 0 }),
      )
    },
  )
  it("keeps stale inspection candidates unavailable until a current pin is inspected", async () => {
    const f = fixture()
    f.binding.pinRevision = 2
    const occurrence = f.inspection.occurrences[0]
    if (!occurrence) throw new Error("Expected inspected occurrence.")
    occurrence.pinRevision = 1
    const onChange = vi.fn()
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <AssemblyFrameBindingFields
          prefix="child"
          assembly={f.assembly}
          inspection={f.inspection}
          instanceId={f.f.parent.id}
          binding={f.binding}
          onChange={onChange}
        />
      </I18nProvider>,
    )
    const control = screen.getByRole("combobox", { name: "Child frame geometry" })
    expect(control.textContent).toContain("Unresolved saved reference")
    await userEvent.click(control)
    expect(screen.queryByRole("option", { name: /PLANE/ })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})
