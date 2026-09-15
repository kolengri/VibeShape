// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createLengthQuantity,
  datumPlaneFeatureType,
  documentSnapshotSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, describe, expect, it } from "vitest"
import type { DocumentControllerState } from "../../document/document-controller"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { MeasurementTaskPanel } from "./measurement-task-panel"

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f6101"
const featureId = (index: number) =>
  `0195b5ac-b220-7a2c-8c33-${String(index + 1).padStart(12, "0")}`
const contentHash = "a".repeat(64)

const shape = {
  valid: true,
  volume: 6000,
  surfaceArea: 2200,
  bounds: { min: [0, 0, 0], max: [10, 20, 30] },
  faceCount: 6,
  edgeCount: 12,
  solidCount: 1,
}

function fixture(
  count = 1,
  failed = false,
  datumPlane = false,
  bodyRoles: readonly string[] | undefined = undefined,
) {
  const features = Array.from({ length: count }, (_, index) =>
    featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureId(index),
      type: datumPlane
        ? datumPlaneFeatureType.type
        : {
            moduleId: "vibeshape.part-design",
            moduleVersion: "1.0.0",
            typeId: "vibeshape.box",
            schemaVersion: 1,
          },
      parameters: datumPlane
        ? {
            mode: "offset",
            support: { kind: "origin-plane", plane: "xy" },
            offset: createLengthQuantity(5),
          }
        : {},
      dependencies: [],
      references: [],
      suppressed: false,
      label: `Box ${index + 1}`,
    }),
  )
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 7,
    name: "Measured bodies",
    createdAt: "2026-09-05T00:00:00Z",
    updatedAt: "2026-09-05T00:00:00Z",
    features,
  })
  const records = features.map((feature, index) => ({
    featureId: feature.id,
    status: failed && index === 0 ? "failed" : "succeeded",
    ...(failed && index === 0
      ? { diagnostics: [{ code: "org.vibeshape.geometry.invalid", values: {} }] }
      : { contentHash }),
  }))
  const geometry = failed
    ? []
    : features.map((feature, index) => ({
        featureId: feature.id,
        contentHash,
        meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
        geometry: {
          engine: {
            adapter: "replicad",
            adapterVersion: "test-build",
            replicadVersion: "0.23.1",
            opencascadePackageVersion: "0.23.0",
            opencascadeSourceRevision: null,
            wasmBytes: 1,
            initializedInMs: 1,
            featureContentEnvironment: {
              schemaVersion: 0,
              hostApiVersion: "0.1.0",
              geometry: {
                adapterId: "org.vibeshape.geometry.replicad",
                adapterVersion: "test-build",
                kernelId: "org.opencascade.occt",
                kernelVersion: "7.9.2",
                kernelSourceRevision: null,
              },
              modelingTolerancePolicyVersion: 1,
              provider: { kind: "built-in" },
            },
          },
          shape: {
            ...shape,
            solidCount: index === 0 && bodyRoles ? bodyRoles.length : shape.solidCount,
            volume: shape.volume + index * 1000,
          },
          ...(index === 0 && bodyRoles
            ? {
                bodies: bodyRoles.map((outputRole, bodyIndex) => ({
                  outputRole,
                  shape: { ...shape, volume: shape.volume + bodyIndex * 1000 },
                  topologyCandidates: [],
                  mesh: {
                    positions: new Float32Array([0, 0, 0]),
                    normals: new Float32Array([0, 0, 1]),
                    indices: new Uint32Array([0, 0, 0]),
                    triangleFaceIds: new Uint32Array([1]),
                  },
                })),
              }
            : {}),
          topologyCandidates: [],
          mesh: {
            positions: new Float32Array([0, 0, 0]),
            normals: new Float32Array([0, 0, 1]),
            indices: new Uint32Array([0, 0, 0]),
            triangleFaceIds: new Uint32Array([1]),
          },
          cache: { brepHit: false },
          timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
        },
      }))
  const response = {
    protocolVersion: 20,
    requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f6201",
    documentId,
    revision: 7,
    generation: 2,
    type: "documentRebuilt",
    evaluation: {
      records,
      dirtyFeatureIds: [],
      evaluatedFeatureIds: features.map((feature) => feature.id),
      reusedFeatureIds: [],
    },
    geometry,
    sketches: [],
    modelReferenceEvidence: [],
  }
  return { snapshot, response }
}

function controller(
  options: {
    count?: number
    failed?: boolean
    stale?: boolean
    datumPlane?: boolean
    bodyRoles?: readonly string[]
    status?: DocumentControllerState["status"]
    saveStatus?: DocumentControllerState["saveStatus"]
    report?: DocumentControllerState["report"]
  } = {},
) {
  const { snapshot, response } = fixture(
    options.count,
    options.failed,
    options.datumPlane,
    options.bodyRoles,
  )
  return {
    status: options.status ?? "ready",
    saveStatus: options.saveStatus ?? "saved",
    diagnostic: null,
    report:
      options.report === undefined
        ? {
            mode: "read-write",
            snapshot,
            rebuild: {
              ok: true,
              response: options.stale ? { ...response, revision: 6 } : response,
            },
          }
        : options.report,
  } as unknown as DocumentControllerState
}

function renderPanel(
  state: DocumentControllerState,
  selectedFeatureId: string | null = featureId(0),
  selectedOutputRole?: string | null,
) {
  return render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <DocumentDisplayUnitsProvider displayUnits={{ angle: "deg", length: "cm" }}>
        <MeasurementTaskPanel
          controller={state}
          selectedFeatureId={selectedFeatureId}
          {...(selectedOutputRole === undefined ? {} : { selectedOutputRole })}
          onClose={() => undefined}
        />
      </DocumentDisplayUnitsProvider>
    </I18nProvider>,
  )
}

afterEach(cleanup)

describe("MeasurementTaskPanel", () => {
  it("renders ready geometry values in the selected project units", () => {
    renderPanel(controller())

    expect(screen.getByText("6 cm³")).toBeTruthy()
    expect(screen.getByText("22 cm²")).toBeTruthy()
    expect(screen.getByText("1 cm")).toBeTruthy()
    expect(screen.getByText("2 cm")).toBeTruthy()
    expect(screen.getByText("3 cm")).toBeTruthy()
    expect(screen.getByText("1", { selector: "dd" })).toBeTruthy()
  })

  it("paginates all outputs and displays the selected second entry", async () => {
    const user = userEvent.setup()
    renderPanel(controller({ count: 21 }))

    await user.click(screen.getByRole("button", { name: "Show all current outputs" }))
    expect(
      screen.getByRole("combobox", { name: "Body output" }).querySelectorAll("option"),
    ).toHaveLength(20)
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false)

    const secondOption = screen.getByRole("option", { name: "Box 2" }) as HTMLOptionElement
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Body output" }),
      secondOption.value,
    )
    expect((screen.getByRole("combobox", { name: "Body output" }) as HTMLSelectElement).value).toBe(
      `${featureId(1)}\u0000`,
    )
    expect(screen.getByText("7 cm³")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("21 outputs")).toBeTruthy()
    expect(
      screen.getByRole("combobox", { name: "Body output" }).querySelectorAll("option"),
    ).toHaveLength(1)
    expect(screen.getByRole("option", { name: "Box 21" })).toBeTruthy()
    expect(screen.getByText("26 cm³")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    await user.click(screen.getByRole("button", { name: "Previous" }))
    expect(
      screen.getByRole("combobox", { name: "Body output" }).querySelectorAll("option"),
    ).toHaveLength(20)
    expect(screen.getByText("6 cm³")).toBeTruthy()
  })

  it("uses the selected feature as the initial output and offers show-all", async () => {
    const user = userEvent.setup()
    renderPanel(controller({ count: 2 }), featureId(1))

    expect((screen.getByRole("combobox", { name: "Body output" }) as HTMLSelectElement).value).toBe(
      `${featureId(1)}\u0000`,
    )
    expect(screen.getByRole("button", { name: "Show all current outputs" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Show all current outputs" }))
    expect(screen.getByText("2 outputs")).toBeTruthy()
    expect((screen.getByRole("combobox", { name: "Body output" }) as HTMLSelectElement).value).toBe(
      `${featureId(0)}\u0000`,
    )
  })

  it.each([
    ["loading", { status: "loading" as const }],
    ["saving", { saveStatus: "saving" as const }],
    ["stale", { stale: true }],
  ])("hides values while the document is %s", (_state, overrides) => {
    const view = renderPanel(controller())
    expect(screen.getByText("6 cm³")).toBeTruthy()

    view.rerender(
      <I18nProvider i18n={i18n} initialLocale="en">
        <DocumentDisplayUnitsProvider displayUnits={{ angle: "deg", length: "cm" }}>
          <MeasurementTaskPanel
            controller={controller(overrides)}
            selectedFeatureId={featureId(0)}
            onClose={() => undefined}
          />
        </DocumentDisplayUnitsProvider>
      </I18nProvider>,
    )

    expect(screen.getByRole("status").textContent).toBe(
      "Measurements are unavailable until the model has a current rebuild.",
    )
    expect(screen.queryByText("6 cm³")).toBeNull()
  })

  it("renders measurement failures without inventing zero values", () => {
    const view = renderPanel(controller())
    expect(screen.getByText("6 cm³")).toBeTruthy()
    view.rerender(
      <I18nProvider i18n={i18n} initialLocale="en">
        <DocumentDisplayUnitsProvider displayUnits={{ angle: "deg", length: "cm" }}>
          <MeasurementTaskPanel
            controller={controller({ failed: true })}
            selectedFeatureId={featureId(0)}
            onClose={() => undefined}
          />
        </DocumentDisplayUnitsProvider>
      </I18nProvider>,
    )

    expect(screen.getByRole("status").textContent).toBe(
      "Measurements are unavailable until the model has a current rebuild.",
    )
    expect(screen.queryByText(/0 cm/)).toBeNull()
    expect(screen.queryByText(/0 cm²/)).toBeNull()
  })

  it("explains that a construction plane cannot be measured and shows no outputs", async () => {
    const user = userEvent.setup()
    renderPanel(controller({ datumPlane: true }))

    expect(screen.getByRole("status").textContent).toBe(
      "Construction planes cannot be measured as solid outputs. Choose a model output to inspect.",
    )
    expect(screen.queryByText(/cm³/)).toBeNull()

    await user.click(screen.getByRole("button", { name: "Show all current outputs" }))
    expect(screen.getByText("There are no current model outputs to measure.")).toBeTruthy()
  })

  it("allows measurement queries in a read-only document", () => {
    const state = controller()
    renderPanel({ ...state, report: state.report ? { ...state.report, mode: "read-only" } : null })

    expect(screen.getByText("6 cm³")).toBeTruthy()
  })

  it("keeps sibling body outputs distinct when their feature is shared", async () => {
    const user = userEvent.setup()
    renderPanel(
      controller({ bodyRoles: ["pattern.instance.0", "pattern.instance.1"] }),
      featureId(0),
      "pattern.instance.1",
    )

    expect(screen.getByRole("option", { name: "Box 1" })).toBeTruthy()
    expect(screen.getByText("7 cm³")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Show all current outputs" }))
    expect(screen.getByRole("option", { name: "Box 1 · Body 1" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "Box 1 · Body 2" })).toBeTruthy()
  })

  it("does not fall back to another body when the selected role is missing", () => {
    renderPanel(
      controller({ bodyRoles: ["pattern.instance.0", "pattern.instance.1"] }),
      featureId(0),
      "pattern.instance.9",
    )

    expect(screen.getByRole("status").textContent).toBe(
      "The selected body output is no longer available.",
    )
    expect(screen.queryByText(/cm³/)).toBeNull()
  })
})
