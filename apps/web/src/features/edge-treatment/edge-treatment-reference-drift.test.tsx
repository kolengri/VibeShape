import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createLengthQuantity, type FeatureRecord, featureRecordSchema } from "@vibeshape/domain"
import {
  chamferFeatureParametersV3Schema,
  chamferFeatureTypeV2,
  chamferFeatureTypeV3,
} from "@vibeshape/domain/part-design"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import {
  candidate,
  copy,
  defaultProps,
  documentId,
  geometry,
  option,
  sourceId,
  treatmentId,
} from "./edge-treatment.test-fixtures"
import {
  type EdgeTreatmentCandidate,
  edgeTreatmentCandidates,
  legacyEdgeReference,
  resolveTreatmentReference,
  sameTreatmentReference,
  treatmentReferenceMatchesCandidate,
} from "./edge-treatment-candidates"
import { EdgeTreatmentForm } from "./edge-treatment-form"
import { useEdgeTreatmentPicking } from "./use-edge-treatment-picking"

afterEach(cleanup)

function shiftedCandidate(kind: "edge" | "face", shift: number) {
  const value = candidate(kind)
  const move = ([x, y, z]: readonly [number, number, number]): [number, number, number] => [
    x + shift,
    y,
    z,
  ]
  return {
    ...value,
    signature: {
      ...value.signature,
      centroid: move(value.signature.centroid),
      bounds: { min: move(value.signature.bounds.min), max: move(value.signature.bounds.max) },
    },
  }
}

function catalogue(shift: number, role = "pattern.instance.0") {
  return [
    option(
      sourceId,
      role,
      "Body A",
      [shiftedCandidate("edge", shift), candidate("edge", 2)],
      [shiftedCandidate("face", shift), candidate("face", 2)],
    ),
  ]
}

function exactReference(
  candidates: readonly EdgeTreatmentCandidate[],
  kind: "edge" | "face",
  index: number,
) {
  const reference = candidates.filter((entry) => entry.reference.kind === kind)[index]?.reference
  if (reference?.schemaVersion !== 1) throw new Error("The fixture requires exact body topology.")
  return reference
}

function fixture(role = "pattern.instance.0") {
  const options = catalogue(0.1, role)
  const models = geometry(options)
  const candidates = edgeTreatmentCandidates(
    options,
    models,
    (kind, ordinal) => `${kind} ${ordinal}`,
  )
  const old = edgeTreatmentCandidates(catalogue(0, role), geometry(catalogue(0, role)), () => "old")
  const older = edgeTreatmentCandidates(
    catalogue(-0.1, role),
    geometry(catalogue(-0.1, role)),
    () => "older",
  )
  const second = {
    ...exactReference(old, "edge", 1),
    intent: { nearPoint: [20, 0, 0] as [number, number, number] },
  }
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: treatmentId,
    type: chamferFeatureTypeV3.type,
    parameters: {
      targetBody: options[0]?.body,
      mode: "two-distances",
      distance: createLengthQuantity(1, "mm", "1 mm"),
      secondDistance: createLengthQuantity(2, "mm", "2 mm"),
      measurement: "tangent",
      flip: true,
      tangentPropagation: true,
      targets: [
        {
          kind: "edge",
          edge: exactReference(old, "edge", 0),
          sideFace: exactReference(old, "face", 0),
        },
        { kind: "edge", edge: second, sideFace: exactReference(old, "face", 1) },
      ],
      directionOverrides: [exactReference(older, "edge", 0), second],
    },
    dependencies: [sourceId],
    references: [],
    suppressed: false,
    label: "Chamfer 1",
  })
  const parameters = chamferFeatureParametersV3Schema.parse(feature.parameters)
  return { options, models, candidates, feature, parameters }
}

function form(value: ReturnType<typeof fixture>) {
  const onSave = vi.fn(async (_revision: number, _feature: FeatureRecord) => ({
    ok: true as const,
  }))
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <EdgeTreatmentForm
        {...defaultProps(value.options)}
        topologyCandidates={value.models}
        mode={{ kind: "edit", feature: value.feature }}
        onSave={onSave}
      />
    </I18nProvider>,
  )
  return onSave
}

it.each(["result", "pattern.instance.0"])(
  "deselects a uniquely resolved older anonymous target on %s and removes only its direction override",
  async (role) => {
    const value = fixture(role)
    const onSave = form(value)
    await userEvent.click(screen.getByText("Keyboard choices", { selector: "summary" }))
    await userEvent.click(screen.getByRole("button", { name: "Body A · Edge 1" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove Edge 1" })).toBeNull())
    expect(screen.getByRole("button", { name: "Remove Edge 2" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: copy.submit }))
    const saved = featureRecordSchema.parse(onSave.mock.calls[0]?.[1])
    expect(chamferFeatureParametersV3Schema.parse(saved.parameters)).toEqual({
      ...value.parameters,
      targets: value.parameters.targets.slice(1),
      directionOverrides: value.parameters.directionOverrides.slice(1),
    })
  },
)

it.each(["result", "pattern.instance.0"])(
  "removes the authored row on %s and cleans its resolved older override without removing another target",
  async (role) => {
    const value = fixture(role)
    const onSave = form(value)
    await userEvent.click(screen.getByRole("button", { name: "Remove Edge 1" }))
    await userEvent.click(screen.getByRole("button", { name: copy.submit }))
    const saved = featureRecordSchema.parse(onSave.mock.calls[0]?.[1])
    expect(chamferFeatureParametersV3Schema.parse(saved.parameters)).toEqual({
      ...value.parameters,
      targets: value.parameters.targets.slice(1),
      directionOverrides: value.parameters.directionOverrides.slice(1),
    })
  },
)

it("promotes a resolved older legacy edge without rewriting its stored signature or intent", async () => {
  const value = fixture("result")
  const target = value.parameters.targets[0]
  if (target?.kind !== "edge") throw new Error("The legacy fixture requires an edge.")
  const legacy = legacyEdgeReference(target.edge)
  if (!legacy) throw new Error("The legacy fixture requires the result body.")
  const reference = { ...legacy, intent: { nearPoint: [10, 0, 0] as [number, number, number] } }
  const feature = featureRecordSchema.parse({
    ...value.feature,
    type: chamferFeatureTypeV2.type,
    parameters: { distance: value.parameters.distance },
    references: [reference],
  })
  const onSave = form({ ...value, feature })
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Chamfer mode" }),
    "two-distances",
  )
  await userEvent.click(screen.getByRole("button", { name: "Pick side face for Edge 1" }))
  await userEvent.click(screen.getByText("Keyboard choices", { selector: "summary" }))
  await userEvent.click(screen.getByRole("button", { name: "Body A · Face 1" }))
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  const saved = featureRecordSchema.parse(onSave.mock.calls[0]?.[1])
  const parameters = chamferFeatureParametersV3Schema.parse(saved.parameters)
  expect(parameters.targets).toHaveLength(1)
  expect(parameters.targets[0]).toMatchObject({
    kind: "edge",
    edge: { ...reference, schemaVersion: 1, outputRole: "result" },
  })
})

it.each(["result", "pattern.instance.0"])(
  "restores drifted side-face labels and removes an older anonymous override on %s without changing target intent",
  async (role) => {
    const value = fixture(role)
    const onSave = form(value)
    expect(screen.getByRole("button", { name: "Pick side face for Edge 1" }).textContent).toBe(
      "Face 1",
    )
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Reverse Edge 1" }).checked).toBe(
      true,
    )
    await userEvent.click(screen.getByRole("checkbox", { name: "Reverse Edge 1" }))
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>("checkbox", { name: "Reverse Edge 1" }).checked,
      ).toBe(false),
    )
    await userEvent.click(screen.getByRole("button", { name: copy.submit }))
    const saved = featureRecordSchema.parse(onSave.mock.calls[0]?.[1])
    expect(chamferFeatureParametersV3Schema.parse(saved.parameters)).toEqual({
      ...value.parameters,
      directionOverrides: value.parameters.directionOverrides.slice(1),
    })
  },
)

it("highlights the current anonymous edges and side faces for uniquely resolved older intent", () => {
  const value = fixture()
  const controller = {
    saveStatus: "saved",
    report: {
      mode: "read-write",
      snapshot: { id: documentId, revision: 3 },
      rebuild: {
        ok: true,
        response: { geometry: value.models, generation: 1, requestId: "current" },
      },
    },
  } as unknown as DocumentControllerState
  const { result } = renderHook(
    () => useEdgeTreatmentPicking(controller, { kind: "edit-chamfer", featureId: treatmentId }, []),
    {
      wrapper: ({ children }) => (
        <I18nProvider i18n={i18n} initialLocale="en">
          {children}
        </I18nProvider>
      ),
    },
  )
  const context = {
    featureId: treatmentId,
    targetFeatureId: sourceId,
    targetOptionId: value.options[0]?.id ?? "",
    options: value.options,
    references: [],
    scope: "selected" as const,
    targets: value.parameters.targets,
    directionOverrides: value.parameters.directionOverrides,
  }
  act(() => result.current.onContextChange({ ...context, pick: { kind: "edges" } }))
  expect(
    result.current.viewportContext?.referenceSelection?.candidates.map(
      (entry) => entry.kind === "model-curve" && entry.selected,
    ),
  ).toEqual([true, true])
  act(() => result.current.onContextChange({ ...context, pick: { kind: "faces" } }))
  expect(result.current.viewportContext?.faceIntersectionSelection?.selectedFaces).toEqual([
    { featureId: sourceId, outputRole: "pattern.instance.0", faceId: 1, faceOrdinal: 0 },
    { featureId: sourceId, outputRole: "pattern.instance.0", faceId: 2, faceOrdinal: 0 },
  ])
})

it("keeps authored equality exact while refusing unresolved, ambiguous and foreign-output candidate matches", () => {
  const value = fixture()
  const stored = value.parameters.targets[0]
  const current = value.candidates.find((entry) => entry.reference.kind === "edge")
  if (stored?.kind !== "edge" || !current) throw new Error("The drift fixture requires an edge.")
  expect(sameTreatmentReference(stored.edge, current.reference)).toBe(false)
  expect(resolveTreatmentReference(stored.edge, value.candidates).status).toBe("resolved")
  expect(treatmentReferenceMatchesCandidate(stored.edge, current, value.candidates)).toBe(true)
  expect(treatmentReferenceMatchesCandidate(stored.edge, current, [])).toBe(false)
  const face = value.candidates.find((entry) => entry.reference.kind === "face")
  if (!face) throw new Error("The current body must have face evidence.")
  expect(
    treatmentReferenceMatchesCandidate(stored.edge, { ...face, id: current.id }, value.candidates),
  ).toBe(false)
  const duplicateOptions = [
    option(sourceId, "pattern.instance.0", "Body A", [
      shiftedCandidate("edge", 0.1),
      { ...shiftedCandidate("edge", 0.1), candidateId: "duplicate" },
    ]),
  ]
  const ambiguous = edgeTreatmentCandidates(
    duplicateOptions,
    geometry(duplicateOptions),
    () => "edge",
  )
  expect(resolveTreatmentReference(stored.edge, ambiguous).status).toBe("ambiguous")
  expect(treatmentReferenceMatchesCandidate(stored.edge, current, ambiguous)).toBe(false)
  const siblingOptions = catalogue(0.1, "pattern.instance.1")
  const sibling = edgeTreatmentCandidates(
    siblingOptions,
    geometry(siblingOptions),
    () => "sibling",
  )[0]
  if (!sibling) throw new Error("The sibling output must have an edge.")
  expect(
    treatmentReferenceMatchesCandidate(stored.edge, sibling, [...value.candidates, sibling]),
  ).toBe(false)
})
