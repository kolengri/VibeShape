import "../../../../../tests/unit/support/dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createAngleQuantity,
  createLengthQuantity,
  extrusionFeatureType,
  extrusionFeatureTypeV4,
  extrusionFeatureTypeV5,
  extrusionFeatureTypeV7,
  extrusionFeatureTypeV8,
  featureIdSchema,
  featureRecordSchema,
  legacyExtrusionFeatureType,
  multiProfileExtrusionFeatureType,
  sketchProfileSelectorSchema,
  topoRefSchema,
  variableIdSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useLayoutEffect } from "react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import type { DocumentControllerState } from "../../document/document-controller"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { CadErrorPresentation } from "../../shell/cad-error-presentation"
import { ReferencePickProvider, useReferencePicking } from "../../shell/reference-pick-context"
import { collectedExtrusionOptions, extrusionBodyFixture } from "./extrusion-body-test-fixtures"
import type { ExtrusionDistanceRequest } from "./extrusion-distance-manipulator"
import { ExtrusionForm, type ExtrusionFormMode, type ExtrusionTargetOption } from "./extrusion-form"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3601")
const supportFeatureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3603")
const supportReference = topoRefSchema.parse({
  schemaVersion: 0,
  featureId: supportFeatureId,
  kind: "face",
  semanticRole: "extrusion.cap.end",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 400,
    centroid: [0, 0, 10],
    bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
    direction: [0, 0, 1],
    directionMode: "oriented",
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE"],
  },
})
const profile = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3211"],
  holeBoundaryEntityIds: [],
})
const replacementProfile = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3202",
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3212"],
  holeBoundaryEntityIds: [],
})
const secondProfile = sketchProfileSelectorSchema.parse({
  ...profile,
  outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3213"],
})
const variables = [
  {
    schemaVersion: 0 as const,
    id: variableIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2601"),
    name: "depth",
    expression: "18 mm",
  },
]
const copy = {
  title: "Extrude profile",
  description: "Create a new solid.",
  parameters: "Extrusion parameters",
  profile: "Selected profile",
  clearProfiles: "Clear selected profiles",
  removeProfile: (label: string) => `Remove ${label}`,
  operation: "Result operation",
  operationNew: "New body",
  operationAdd: "Add to body",
  operationRemove: "Remove from body",
  operationIntersect: "Intersect with body",
  target: "Target body",
  targetDescription: "Choose a terminal body.",
  missingProfile: "Select a sketch profile.",
  missingTarget: "Select a target body.",
  distance: "Distance",
  symmetric: "Extrude symmetrically",
  reversed: "Reverse first direction",
  secondDirection: "Second direction",
  secondDistance: "Second distance",
  symmetricDescription: "Symmetric distance is the total span.",
  extentInvalidRange: "Each depth must be at least 0.001 mm; total span at most 100,000 mm.",
  expressionDescription: "Enter a length or #variable.",
  submit: "Create extrusion",
  cancel: "Cancel",
  invalidExpression: "Enter a valid expression.",
  invalidDimension: "Expression must resolve to a length.",
  invalidRange: "Enter a positive supported length.",
  validationSummary: "Fix the highlighted distance.",
  staleRevision: "The document changed.",
  saveFailed: "The extrusion could not be created.",
} as const

const existingFeature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: extrusionFeatureType.type,
  parameters: {
    profile,
    distance: createLengthQuantity(18, "mm", "#depth"),
    symmetric: true,
    operation: "new",
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Extrusion 1",
})

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function ReferencePickerProbe({
  onChange,
}: {
  onChange: (picker: ReturnType<typeof useReferencePicking>) => void
}) {
  const picker = useReferencePicking()
  useLayoutEffect(() => onChange(picker), [onChange, picker])
  return null
}

function renderForm(
  onSave = vi.fn(async () => ({ ok: true as const })),
  onSaved = vi.fn(),
  mode: ExtrusionFormMode = {
    kind: "create",
    createFeatureId: () => featureId,
    featureLabel: "Extrusion 1",
    profiles: [profile],
  },
  onPreviewChange = vi.fn(),
  distanceRequest?: ExtrusionDistanceRequest,
  angleUnit: "deg" | "rad" = "deg",
  options: readonly ExtrusionTargetOption[] = [
    {
      id: featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3602"),
      label: "Box 1",
    },
  ],
  pickingController?: DocumentControllerState,
) {
  const formCopy = mode.kind === "edit" ? { ...copy, submit: "Update extrusion" } : copy
  let picker: ReturnType<typeof useReferencePicking> = null
  const form = (
    <ExtrusionForm
      baseRevision={4}
      copy={formCopy}
      distanceRequest={distanceRequest}
      mode={mode}
      options={options}
      profileLabel="Sketch 1"
      variables={variables}
      onCancel={vi.fn()}
      onPreviewChange={onPreviewChange}
      onSave={onSave}
      onSaved={onSaved}
    />
  )
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <DocumentDisplayUnitsProvider displayUnits={{ length: "mm", angle: angleUnit }}>
        {pickingController ? (
          <ReferencePickProvider
            controller={pickingController}
            activityKey="extrusion:create"
            hiddenFeatureIds={[]}
          >
            <ReferencePickerProbe
              onChange={(value) => {
                picker = value
              }}
            />
            {form}
          </ReferencePickProvider>
        ) : (
          form
        )}
      </DocumentDisplayUnitsProvider>
    </I18nProvider>,
  )
  return {
    formCopy,
    onPreviewChange,
    onSave,
    onSaved,
    pick: (selection: ViewerSelection) => {
      const select = picker?.viewportContext?.faceIntersectionSelection?.onSelect
      if (!select) throw new Error("Expected an active viewport reference field.")
      act(() => select(selection))
    },
  }
}

beforeAll(() => {
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

it.each(["up-to-body", "up-to-face"] as const)(
  "selects an exact sibling output through the %s viewport field",
  async (kind) => {
    const fixture = extrusionBodyFixture(undefined, true, "SPHERE")
    const target = fixture.options[1]
    const face = target?.faces?.[0]
    if (!target?.outputRole || face?.meshFaceId === undefined)
      throw new Error("Expected a current curved face on the second body.")
    const controller: DocumentControllerState = {
      status: "ready",
      saveStatus: "saved",
      diagnostic: null,
      report: {
        status: "created",
        mode: "read-write",
        snapshot: fixture.snapshot,
        historyItems: null,
        rebuild: fixture.rebuild,
        lostRevisionCount: 0,
        corruptRecords: [],
        migration: null,
        writeAccessDiagnostic: null,
      },
    }
    const { onSave, pick } = renderForm(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "deg",
      fixture.options,
      controller,
    )
    fireEvent.change(screen.getByLabelText("End condition"), { target: { value: kind } })
    await userEvent.click(
      screen.getByRole("button", {
        name: kind === "up-to-face" ? "Select End face in 3D" : "Select End support body in 3D",
      }),
    )
    pick({
      featureId: target.id,
      outputRole: target.outputRole,
      faceId: face.meshFaceId,
      faceOrdinal: 1,
    })
    const form = screen.getByRole("form") as HTMLFormElement
    expect((form.elements.namedItem("endTarget") as HTMLSelectElement).value).toBe(
      `${target.id}:${target.outputRole}`,
    )
    if (kind === "up-to-face") {
      expect((form.elements.namedItem("endFace") as HTMLSelectElement).value).toBe(
        JSON.stringify(face.reference),
      )
    }
    await userEvent.click(screen.getByRole("button", { name: copy.submit }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        parameters: expect.objectContaining({
          endCondition: expect.objectContaining({
            kind,
            targetBody: { schemaVersion: 0, featureId: target.id, outputRole: target.outputRole },
            sourceContentHash: target.contentHash,
            ...(kind === "up-to-face" ? { face: face.reference } : {}),
          }),
        }),
      }),
    )
    expect(JSON.stringify(onSave.mock.calls)).not.toContain("meshFaceId")
  },
)

it("authors v7 when choosing a current finite curved face from the real body collector", async () => {
  const options = collectedExtrusionOptions(undefined, false, "SPHERE")
  const selected = options[0]?.faces?.[0]
  if (!selected) throw new Error("Expected a uniquely resolved spherical face.")
  const onSave = vi.fn(async () => ({ ok: true as const }))
  renderForm(onSave, vi.fn(), undefined, vi.fn(), undefined, "deg", options)
  fireEvent.change(screen.getByLabelText("End condition"), { target: { value: "up-to-face" } })
  await userEvent.click(screen.getByRole("combobox", { name: "End face" }))
  await userEvent.type(screen.getByRole("combobox", { name: "Search options…" }), selected.label)
  await userEvent.click(screen.getByRole("option", { name: selected.label }))
  await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  expect(onSave).toHaveBeenCalledWith(
    4,
    expect.objectContaining({
      type: expect.objectContaining({ schemaVersion: 7 }),
      parameters: expect.objectContaining({
        targetBody: null,
        endCondition: expect.objectContaining({ kind: "up-to-face", face: selected.reference }),
      }),
      dependencies: [selected.reference.featureId],
    }),
  )
})

it("preserves the saved v7 schema when explicitly changing its endpoint to a planar face", async () => {
  const options = collectedExtrusionOptions(undefined, false, "PLANE")
  const selected = options[0]?.faces?.[0]
  if (!selected) throw new Error("Expected a uniquely resolved planar face.")
  const original = featureRecordSchema.parse({
    ...existingFeature,
    type: extrusionFeatureTypeV7.type,
    parameters: {
      profiles: { schemaVersion: 0, profiles: [profile] },
      distance: createLengthQuantity(10),
      symmetric: false,
      reversed: false,
      secondDistance: null,
      operation: "new",
      targetBody: null,
      startOffset: createLengthQuantity(0),
      draftAngle: createAngleQuantity(0),
      endCondition: {
        kind: "up-to-face",
        targetBody: {
          schemaVersion: 0,
          featureId: selected.reference.featureId,
          outputRole: selected.reference.outputRole,
        },
        sourceContentHash: options[0]?.contentHash,
        face: selected.reference,
      },
    },
    dependencies: [selected.reference.featureId],
  })
  const onSave = vi.fn(async () => ({ ok: true as const }))
  renderForm(
    onSave,
    vi.fn(),
    { kind: "edit", feature: original, profiles: [profile] },
    vi.fn(),
    undefined,
    "deg",
    options,
  )
  await userEvent.setup().click(screen.getByRole("button", { name: "Update extrusion" }))
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  expect(onSave).toHaveBeenCalledWith(
    4,
    expect.objectContaining({
      id: original.id,
      type: expect.objectContaining({ schemaVersion: 7 }),
      parameters: expect.objectContaining({
        endCondition: expect.objectContaining({ face: selected.reference }),
      }),
    }),
  )
})

async function selectOperation(user: ReturnType<typeof userEvent.setup>, operation: string) {
  const labels: Record<string, string> = {
    new: "New body",
    add: "Add to body",
    remove: "Remove from body",
    intersect: "Intersect with body",
  }
  const label = labels[operation]
  if (!label) throw new Error("Unknown result operation fixture.")
  await user.click(screen.getByRole("radio", { name: label }))
}

describe("ExtrusionForm", () => {
  it.each(
    [2, 4, 5].flatMap((version) =>
      ["add", "remove", "intersect"].map((operation) => ({ version, operation })),
    ),
  )(
    "edits legacy v$version $operation using the real named-body collector without narrowing the producer",
    async ({ version, operation }) => {
      const feature = featureRecordSchema.parse({
        ...existingFeature,
        type: { ...existingFeature.type, schemaVersion: version },
        parameters: {
          distance: createLengthQuantity(18, "mm", "#depth"),
          symmetric: false,
          operation,
          ...(version === 2
            ? { profile }
            : { profiles: { schemaVersion: 0, profiles: [profile] } }),
          ...(version === 5 ? { reversed: true, secondDistance: null } : {}),
        },
        dependencies: ["0195b5ac-b220-7a2c-8c33-67a36a7f3602"],
      })
      const options = collectedExtrusionOptions(feature, true)
      expect(options.map(({ outputRole }) => outputRole)).toEqual([
        undefined,
        "compound.input.0",
        "compound.input.1",
      ])
      const { onSave } = renderForm(
        undefined,
        undefined,
        { kind: "edit", feature, profiles: [profile] },
        undefined,
        undefined,
        "deg",
        options,
      )
      await userEvent.click(screen.getByRole("button", { name: "Update extrusion" }))
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onSave).toHaveBeenCalledWith(4, feature)
    },
  )
  it("preserves schema v1 New when opening and applying its existing profile", async () => {
    const feature = featureRecordSchema.parse({
      ...existingFeature,
      type: legacyExtrusionFeatureType.type,
    })
    const { onSave } = renderForm(
      undefined,
      undefined,
      { kind: "edit", feature, profiles: [profile] },
      undefined,
      undefined,
      "deg",
      collectedExtrusionOptions(feature),
    )
    await userEvent.click(screen.getByRole("button", { name: "Update extrusion" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(4, feature)
  })
  it("requires an explicit named body before upgrading a legacy whole-producer modifier", async () => {
    const feature = featureRecordSchema.parse({
      ...existingFeature,
      parameters: { ...existingFeature.parameters, symmetric: false, operation: "add" },
      dependencies: ["0195b5ac-b220-7a2c-8c33-67a36a7f3602"],
    })
    expect(
      collectedExtrusionOptions(undefined, true).every(
        ({ outputRole }) => outputRole !== undefined,
      ),
    ).toBe(true)
    const { onSave } = renderForm(
      undefined,
      undefined,
      { kind: "edit", feature, profiles: [profile] },
      undefined,
      undefined,
      "deg",
      collectedExtrusionOptions(feature, true),
    )
    const offset = screen.getByRole("combobox", { name: "Start offset" })
    await userEvent.clear(offset)
    await userEvent.type(offset, "2 mm")
    await userEvent.click(screen.getByRole("button", { name: "Update extrusion" }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(copy.missingTarget, { selector: "[role='alert']" })).toBeTruthy()
  })
  it("authors signed offset and draft using the project's angle display unit", async () => {
    const { onSave } = renderForm(undefined, undefined, undefined, undefined, undefined, "rad")
    fireEvent.change(screen.getByRole("combobox", { name: "Start offset" }), {
      target: { value: "-2" },
    })
    fireEvent.change(screen.getByRole("combobox", { name: "Draft angle" }), {
      target: { value: "-0.1" },
    })
    await userEvent.setup().click(screen.getByRole("button", { name: copy.submit }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        4,
        expect.objectContaining({
          type: expect.objectContaining({ schemaVersion: 6 }),
          parameters: expect.objectContaining({
            startOffset: expect.objectContaining({ value: -2 }),
            draftAngle: expect.objectContaining({
              value: -0.1,
              source: expect.objectContaining({ expression: "-0.1 rad" }),
            }),
          }),
        }),
      ),
    )
  })
  it("reopens independent extents and changes only the second depth from its handle", async () => {
    const feature = featureRecordSchema.parse({
      ...existingFeature,
      type: extrusionFeatureTypeV5.type,
      parameters: {
        profiles: { schemaVersion: 0, profiles: [profile] },
        distance: createLengthQuantity(18, "mm", "#depth"),
        secondDistance: createLengthQuantity(3),
        symmetric: false,
        reversed: true,
        operation: "new",
      },
    })
    const { onPreviewChange } = renderForm(
      undefined,
      undefined,
      { kind: "edit", feature, profiles: [profile] },
      undefined,
      { featureId, distance: 6.5, sequence: 1, side: "second" },
    )
    expect((screen.getByRole("combobox", { name: copy.distance }) as HTMLInputElement).value).toBe(
      "#depth",
    )
    expect(
      (screen.getByRole("combobox", { name: copy.secondDistance }) as HTMLInputElement).value,
    ).toBe("6.5 mm")
    expect(
      (screen.getByRole("checkbox", { name: copy.reversed }) as HTMLInputElement).checked,
    ).toBe(true)
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: featureId,
          parameters: expect.objectContaining({
            distance: expect.objectContaining({
              source: expect.objectContaining({ expression: "#depth" }),
              value: 18,
            }),
            secondDistance: expect.objectContaining({ value: 6.5 }),
          }),
        }),
      ),
    )
  })
  it("creates unequal two-sided extents and switches explicitly to total-span symmetry", async () => {
    const user = userEvent.setup()
    const { onPreviewChange, onSave } = renderForm()
    await user.click(screen.getByRole("checkbox", { name: copy.secondDirection }))
    fireEvent.change(screen.getByRole("combobox", { name: copy.secondDistance }), {
      target: { value: "3 mm" },
    })
    await user.click(screen.getByRole("checkbox", { name: copy.reversed }))
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: expect.objectContaining({ schemaVersion: 5 }),
          parameters: expect.objectContaining({
            distance: expect.objectContaining({ value: 10 }),
            secondDistance: expect.objectContaining({ value: 3 }),
            reversed: true,
            symmetric: false,
          }),
        }),
      ),
    )
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("checkbox", { name: copy.symmetric }))
    expect(screen.queryByRole("combobox", { name: copy.secondDistance })).toBeNull()
    expect(
      (screen.getByRole("checkbox", { name: copy.reversed }) as HTMLInputElement).disabled,
    ).toBe(true)
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            distance: expect.objectContaining({ value: 10 }),
            symmetric: true,
          }),
        }),
      ),
    )
  })

  it.each(["0 mm", "-3 mm", "100001 mm"])(
    "rejects invalid second distance %s without saving",
    async (value) => {
      const user = userEvent.setup()
      const { onSave } = renderForm()
      await user.click(screen.getByRole("checkbox", { name: copy.secondDirection }))
      fireEvent.change(screen.getByRole("combobox", { name: copy.secondDistance }), {
        target: { value },
      })
      await user.click(screen.getByRole("button", { name: copy.submit }))
      expect(onSave).not.toHaveBeenCalled()
    },
  )

  it("synchronizes graphical depth into the exact distance field and preview", async () => {
    const onPreviewChange = vi.fn()
    renderForm(undefined, undefined, undefined, onPreviewChange, {
      distance: 42.5,
      featureId,
      sequence: 1,
    })

    expect((screen.getByRole("combobox", { name: copy.distance }) as HTMLInputElement).value).toBe(
      "42.5 mm",
    )
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            distance: expect.objectContaining({ value: 42.5 }),
          }),
        }),
      ),
    )
  })

  it("publishes a debounced schema-valid draft without committing it", async () => {
    const user = userEvent.setup()
    const { onPreviewChange, onSave } = renderForm()

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: featureId, parameters: expect.objectContaining({}) }),
      ),
    )
    const distance = screen.getByRole("combobox", { name: copy.distance })
    await user.clear(distance)
    await user.type(distance, "25 mm")

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: featureId,
          parameters: expect.objectContaining({
            distance: expect.objectContaining({ value: 25 }),
          }),
        }),
      ),
    )
    expect(onSave).not.toHaveBeenCalled()
  })

  it("resolves a variable and guards asynchronous double submission", async () => {
    const user = userEvent.setup()
    const submission = deferred()
    const onSave = vi.fn(async () => {
      await submission.promise
      return { ok: true as const }
    })
    const { onSaved } = renderForm(onSave)
    const distance = screen.getByRole("combobox", { name: copy.distance })
    await user.clear(distance)
    await user.type(distance, "#depth")
    const create = screen.getByRole("button", { name: copy.submit })
    await user.dblClick(create)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        id: featureId,
        parameters: expect.objectContaining({
          profile,
          distance: expect.objectContaining({
            value: 18,
            source: { expression: "#depth", value: 18, unit: "mm" },
          }),
        }),
      }),
    )
    expect(create.getAttribute("aria-busy")).toBe("true")
    submission.resolve()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it("preserves invalid raw input and focuses the distance error", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()
    const distance = screen.getByRole("combobox", { name: copy.distance })
    await user.clear(distance)
    await user.type(distance, "#missing")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(await screen.findByText(copy.invalidExpression)).toBeTruthy()
    expect((distance as HTMLInputElement).value).toBe("#missing")
    expect(document.activeElement).toBe(distance)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("restores the source expression and updates the existing identity", async () => {
    const user = userEvent.setup()
    const mode = { kind: "edit", feature: existingFeature, profiles: [profile] } as const
    const { formCopy, onSave } = renderForm(undefined, undefined, mode)
    const distance = screen.getByRole("combobox", { name: copy.distance })
    expect((distance as HTMLInputElement).value).toBe("#depth")
    expect(
      (screen.getByRole("checkbox", { name: copy.symmetric }) as HTMLInputElement).checked,
    ).toBe(true)
    await user.clear(distance)
    await user.type(distance, "24 mm")
    await user.dblClick(screen.getByRole("button", { name: formCopy.submit }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        id: existingFeature.id,
        label: existingFeature.label,
        parameters: expect.objectContaining({
          profile,
          distance: expect.objectContaining({
            value: 24,
            source: expect.objectContaining({ expression: "24 mm" }),
          }),
        }),
      }),
    )
  })

  it("persists an explicit target dependency for a body-modifying operation", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm()

    await selectOperation(user, "remove")
    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        type: extrusionFeatureType.type,
        parameters: expect.objectContaining({ operation: "remove" }),
        dependencies: ["0195b5ac-b220-7a2c-8c33-67a36a7f3602"],
      }),
    )
  })

  it("persists a canonical multi-profile new-body extrusion", async () => {
    const user = userEvent.setup()
    const { onSave } = renderForm(undefined, undefined, {
      kind: "create",
      createFeatureId: () => featureId,
      featureLabel: "Extrusion 1",
      profiles: [secondProfile, profile],
    })
    expect(
      (screen.getByRole("radio", { name: copy.operationNew }) as HTMLInputElement).disabled,
    ).toBe(false)
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        type: multiProfileExtrusionFeatureType.type,
        parameters: expect.objectContaining({
          operation: "new",
          profiles: expect.objectContaining({ profiles: [profile, secondProfile] }),
        }),
      }),
    )
  })

  it.each(["add", "remove", "intersect"] as const)(
    "persists a canonical multi-profile %s extrusion with an explicit target",
    async (operation) => {
      const user = userEvent.setup()
      const { onSave } = renderForm(undefined, undefined, {
        kind: "create",
        createFeatureId: () => featureId,
        featureLabel: "Extrusion 1",
        profiles: [secondProfile, profile],
      })

      await selectOperation(user, operation)
      await user.click(screen.getByRole("button", { name: copy.submit }))

      expect(onSave).toHaveBeenCalledWith(
        4,
        expect.objectContaining({
          type: extrusionFeatureTypeV4.type,
          parameters: expect.objectContaining({
            operation,
            profiles: expect.objectContaining({ profiles: [profile, secondProfile] }),
          }),
          dependencies: ["0195b5ac-b220-7a2c-8c33-67a36a7f3602"],
        }),
      )
    },
  )

  it("previews and applies a multi-sketch v8 Extrude with every support reference", async () => {
    const user = userEvent.setup()
    const secondSupport = topoRefSchema.parse({
      ...supportReference,
      featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3699",
    })
    const { onSave, onPreviewChange } = renderForm(undefined, undefined, {
      kind: "create",
      createFeatureId: () => featureId,
      featureLabel: "Extrusion 1",
      profiles: [profile, replacementProfile],
      supportReferences: [supportReference, secondSupport],
    })
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: extrusionFeatureTypeV8.type,
          parameters: expect.objectContaining({
            profiles: { schemaVersion: 0, profiles: [profile, replacementProfile] },
          }),
          references: [supportReference, secondSupport],
          dependencies: [supportReference.featureId, secondSupport.featureId],
        }),
      ),
    )
    await user.click(screen.getByRole("button", { name: copy.submit }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        type: extrusionFeatureTypeV8.type,
        references: [supportReference, secondSupport],
        dependencies: [supportReference.featureId, secondSupport.featureId],
      }),
    )
  })

  it("persists a stable support reference and dependency for a face-supported sketch", async () => {
    const user = userEvent.setup()
    const mode: ExtrusionFormMode = {
      kind: "create",
      createFeatureId: () => featureId,
      featureLabel: "Extrusion 1",
      profiles: [profile],
      supportReferences: [supportReference],
    }
    const { onSave } = renderForm(undefined, undefined, mode)

    await user.click(screen.getByRole("button", { name: copy.submit }))

    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        dependencies: [supportFeatureId],
        references: [supportReference],
      }),
    )
  })

  it("previews and saves the graphically replacement profile and its support", async () => {
    const user = userEvent.setup()
    const onPreviewChange = vi.fn()
    const mode: ExtrusionFormMode = {
      kind: "edit",
      feature: existingFeature,
      profiles: [replacementProfile],
      supportReferences: [supportReference],
    }
    const { onSave } = renderForm(undefined, undefined, mode, onPreviewChange)

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ profile: replacementProfile }),
          references: [supportReference],
        }),
      ),
    )
    await user.click(screen.getByRole("button", { name: "Update extrusion" }))
    expect(onSave).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        parameters: expect.objectContaining({ profile: replacementProfile }),
        dependencies: [supportFeatureId],
        references: [supportReference],
      }),
    )
  })
})

it("keeps structured extrusion diagnostics as the sole preview error and restores the fallback when unhandled", async () => {
  const { snapshot } = extrusionBodyFixture(undefined)
  const onSave = vi.fn(async () => ({ ok: true as const }))
  const diagnostics = [
    {
      entity: { kind: "feature" as const, id: featureId },
      code: "org.vibeshape.feature.sketch-profile-missing",
      values: { reason: "no-matching-region" },
      action: "inspect-feature" as const,
    },
  ]
  const content = (previewErrorHandled: boolean, previewStatus: "loading" | "error" | "ready") => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TaskPanelContentProvider
        content={
          previewErrorHandled && previewStatus === "error" ? (
            <CadErrorPresentation
              diagnostics={diagnostics}
              snapshot={snapshot}
              contextLabels={["Sketch 1"]}
            />
          ) : null
        }
      >
        <ExtrusionForm
          baseRevision={4}
          copy={copy}
          mode={{
            kind: "create",
            createFeatureId: () => featureId,
            featureLabel: "Extrusion 1",
            profiles: [profile],
          }}
          options={[]}
          profileLabel="Sketch 1"
          variables={variables}
          onCancel={vi.fn()}
          onSave={onSave}
          onSaved={vi.fn()}
          previewStatus={previewStatus}
          previewErrorHandled={previewErrorHandled}
        />
      </TaskPanelContentProvider>
    </I18nProvider>
  )
  const view = render(content(false, "loading"))
  expect(screen.getByRole("progressbar")).toBeTruthy()
  const distance = screen.getByRole<HTMLInputElement>("combobox", { name: copy.distance })
  await userEvent.clear(distance)
  await userEvent.type(distance, "#depth")
  view.rerender(content(true, "error"))
  expect(screen.getAllByRole("alert")).toHaveLength(1)
  expect(screen.getByRole("alert").querySelector("details")).not.toBeNull()
  expect(
    screen.queryByText(
      "The preview could not be built. Review the inputs and selections. Apply requires a successful preview.",
    ),
  ).toBeNull()
  expect(screen.queryByRole("progressbar")).toBeNull()
  expect(distance.value).toBe("#depth")
  await act(async () => {
    fireEvent.submit(screen.getByRole("form", { name: copy.title }))
  })
  expect(onSave).not.toHaveBeenCalled()

  view.rerender(content(false, "error"))
  expect(screen.getAllByRole("alert")).toHaveLength(1)
  expect(screen.getByRole("alert").textContent).toBe(
    "The preview could not be built. Review the inputs and selections. Apply requires a successful preview.",
  )
  view.rerender(content(false, "ready"))
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.getByRole("combobox", { name: copy.distance })).toBe(distance)
  expect(distance.value).toBe("#depth")
  await userEvent.click(screen.getByRole("button", { name: copy.submit }))
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
})
