import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import {
  candidate,
  documentId,
  geometry,
  option,
  otherId,
  sourceId,
  treatmentId,
} from "./edge-treatment.test-fixtures"
import { edgeTreatmentCandidates } from "./edge-treatment-candidates"
import type { EdgeTreatmentPickingContext } from "./edge-treatment-picking"
import { useEdgeTreatmentPicking } from "./use-edge-treatment-picking"

afterEach(cleanup)
function setup(
  options = [option(), option(otherId, "result", "Body B")],
  polylines = true,
  models = geometry(options, polylines),
) {
  const view = renderHook(
    ({ revision, hidden, rebuildId }) =>
      useEdgeTreatmentPicking(
        {
          saveStatus: "saved",
          report: {
            mode: "read-write",
            snapshot: { id: documentId, revision },
            rebuild: {
              ok: true,
              response: { geometry: models, generation: 1, requestId: rebuildId },
            },
          },
        } as unknown as DocumentControllerState,
        { kind: "create-chamfer" },
        hidden,
      ),
    {
      initialProps: { revision: 3, hidden: [] as string[], rebuildId: "first" },
      wrapper: ({ children }) => (
        <I18nProvider i18n={i18n} initialLocale="en">
          {children}
        </I18nProvider>
      ),
    },
  )
  const context: EdgeTreatmentPickingContext = {
    featureId: treatmentId,
    targetFeatureId: sourceId,
    targetOptionId: options[0]?.id ?? "",
    references: [],
    scope: "selected",
    options,
    pick: { kind: "edges" },
  }
  act(() => view.result.current.onContextChange(context))
  return { ...view, context, models }
}

it("offers eligible edges from other bodies and infers the exact output instead of locking the selected body", () => {
  const options = [
    option(sourceId, "pattern.instance.0", "First"),
    option(sourceId, "pattern.instance.1", "Second"),
  ]
  const { result, context, models } = setup(options)
  const candidates = result.current.viewportContext?.referenceSelection?.candidates
  expect(candidates).toHaveLength(2)
  expect(candidates?.map(({ label }) => label)).toEqual(["First · Edge 1", "Second · Edge 1"])
  expect(
    new Set(
      candidates?.map((candidate) =>
        candidate.kind === "model-curve" ? candidate.candidateId : "",
      ),
    ).size,
  ).toBe(2)
  const second = candidates?.[1]
  if (!second) throw new Error("Missing alternate body edge.")
  act(() => result.current.viewportContext?.referenceSelection?.onSelect(second))
  expect(result.current.request).toMatchObject({
    optionId: options[1]?.id,
    reference: {
      schemaVersion: 1,
      featureId: sourceId,
      outputRole: "pattern.instance.1",
      kind: "edge",
    },
  })
  const reference = edgeTreatmentCandidates(options, models, (kind) => kind)[0]?.reference
  if (reference?.schemaVersion !== 1 || reference.kind !== "edge")
    throw new Error("Missing selected edge fixture.")
  act(() =>
    result.current.onContextChange({
      ...context,
      targets: [{ kind: "edge", edge: { ...reference, kind: "edge" } }],
    }),
  )
  expect(result.current.viewportContext?.referenceSelection?.candidates[0]).toMatchObject({
    selected: true,
  })
})

it("uses exact face IDs only as disposable evidence and refuses a side face from another body", () => {
  const { result, context } = setup()
  act(() => result.current.onContextChange({ ...context, pick: { kind: "faces" } }))
  const selection = result.current.viewportContext?.faceIntersectionSelection
  expect(result.current.viewportContext?.referenceSelection).toBeUndefined()
  expect(
    selection?.isCandidateEligible?.({
      featureId: otherId,
      outputRole: "result",
      faceId: 1,
      faceOrdinal: 1,
    }),
  ).toBe(true)
  act(() =>
    selection?.onSelect({ featureId: otherId, outputRole: "result", faceId: 1, faceOrdinal: 1 }),
  )
  expect(result.current.request?.reference).toMatchObject({
    featureId: otherId,
    outputRole: "result",
    kind: "face",
  })
  expect(result.current.request?.reference).not.toHaveProperty("meshFaceId")
  act(() => result.current.onContextChange({ ...context, pick: { kind: "side-face", index: 0 } }))
  const side = result.current.viewportContext?.faceIntersectionSelection
  expect(
    side?.isCandidateEligible?.({
      featureId: otherId,
      outputRole: "result",
      faceId: 1,
      faceOrdinal: 1,
    }),
  ).toBe(false)
  act(() => side?.onSelect({ featureId: otherId, outputRole: "result", faceId: 1, faceOrdinal: 1 }))
  expect(result.current.request?.issue).toBe("wrong-body")
})

it("picks a side face when the semantic catalogue omits disposable mesh IDs", () => {
  const options = [option()]
  const models = geometry(options)
  const semanticOptions = options.map((entry) => {
    if (!entry.faceEvidence) throw new Error("The fixture requires semantic face evidence.")
    return {
      ...entry,
      faceEvidence: {
        ...entry.faceEvidence,
        candidates: entry.faceEvidence.candidates.map(
          ({ meshFaceId: _meshFaceId, ...face }) => face,
        ),
      },
    }
  })
  const { result, context } = setup(semanticOptions, true, models)
  act(() => result.current.onContextChange({ ...context, pick: { kind: "side-face", index: 0 } }))
  const selection = { featureId: sourceId, outputRole: "result", faceId: 1, faceOrdinal: 1 }
  expect(
    result.current.viewportContext?.faceIntersectionSelection?.isCandidateEligible?.(selection),
  ).toBe(true)
  act(() => result.current.viewportContext?.faceIntersectionSelection?.onSelect(selection))
  expect(result.current.request?.reference).toMatchObject({
    schemaVersion: 1,
    featureId: sourceId,
    outputRole: "result",
    kind: "face",
  })
  expect(result.current.request?.reference).not.toHaveProperty("meshFaceId")
})

it("reports ambiguous mesh-face evidence instead of choosing one face", () => {
  const faces = [candidate("face"), { ...candidate("face", 2), meshFaceId: 1 }]
  const { result, context } = setup([
    option(sourceId, "result", "Body A", [candidate("edge")], faces),
  ])
  act(() => result.current.onContextChange({ ...context, pick: { kind: "faces" } }))
  act(() =>
    result.current.viewportContext?.faceIntersectionSelection?.onSelect({
      featureId: sourceId,
      outputRole: "result",
      faceId: 1,
      faceOrdinal: 1,
    }),
  )
  expect(result.current.request?.issue).toBe("ambiguous")
  expect(result.current.request?.reference).toBeUndefined()
})

it("does not invent curves for missing polylines or hide the catalogue that powers keyboard fallback", () => {
  const { result, context } = setup([option()], false)
  expect(result.current.viewportContext?.referenceSelection?.candidates).toEqual([])
  expect(context.options?.[0]?.edgeEvidence?.candidates).toHaveLength(1)
})

it("invalidates requests on visibility, revision, and rebuild changes while allowing another visible body", () => {
  const { result, context, rerender } = setup()
  const picked = result.current.viewportContext?.referenceSelection?.candidates[0]
  if (!picked) throw new Error("Missing source edge.")
  act(() => result.current.viewportContext?.referenceSelection?.onSelect(picked))
  expect(result.current.request).not.toBeNull()
  rerender({ revision: 3, hidden: [], rebuildId: "replacement" })
  expect(result.current.viewportContext).toBeUndefined()
  expect(result.current.request).toBeNull()
  act(() => result.current.onContextChange(context))
  rerender({ revision: 3, hidden: [sourceId], rebuildId: "replacement" })
  act(() => result.current.onContextChange(context))
  expect(result.current.viewportContext?.referenceSelection?.candidates).toHaveLength(1)
  expect(result.current.viewportContext?.referenceSelection?.candidates[0]).toMatchObject({
    featureId: otherId,
  })
  rerender({ revision: 4, hidden: [sourceId], rebuildId: "replacement" })
  expect(result.current.viewportContext).toBeUndefined()
  expect(result.current.request).toBeNull()
})

it("highlights only the exact picked circular rim within a nearby anonymous pair", () => {
  const lower = candidate("edge", 1, true)
  const upper = {
    ...lower,
    candidateId: "upper",
    signature: {
      ...lower.signature,
      centroid: [10, 0, 0.5] as [number, number, number],
      bounds: {
        min: [10, 0, 0.5] as [number, number, number],
        max: [20, 0, 0.5] as [number, number, number],
      },
    },
  }
  const options = [option(sourceId, "result", "Thin cylinder", [lower, upper])]
  const { result, context, models } = setup(options)
  const reference = edgeTreatmentCandidates(options, models, (kind) => kind, "edge")[1]?.reference
  if (reference?.schemaVersion !== 1 || reference.kind !== "edge")
    throw new Error("The upper rim must be an exact body edge.")
  act(() =>
    result.current.onContextChange({
      ...context,
      targets: [{ kind: "edge", edge: { ...reference, kind: "edge" } }],
    }),
  )
  expect(
    result.current.viewportContext?.referenceSelection?.candidates.map(
      (entry) => entry.kind === "model-curve" && entry.selected,
    ),
  ).toEqual([false, true])
})
