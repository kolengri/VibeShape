// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { featureRecordSchema, sketchProfileSelectorSchema } from "@vibeshape/domain"
import { bodyFaceRefSchema } from "@vibeshape/domain/body-topology-reference"
import { loftFeatureTypeV3 } from "@vibeshape/domain/part-design-loft-v3"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import {
  createLoftV3Project,
  loftFixtureId as id,
} from "../../../../../tests/support/loft-v3-fixture"
import { i18n } from "../../i18n"
import { loftSupportKey, remapLoftOuterTracks } from "./loft-constraint-model"
import { SweepLoftForm } from "./sweep-loft-form"
import {
  type PathSketchOption,
  sweepLoftFeatureRecord,
  sweepLoftFormValues,
} from "./sweep-loft-form-model"
import { copy, featureId, mode } from "./sweep-loft-test-fixtures"

const project = createLoftV3Project()
const profiles = project.sections.map((selector, index) => ({
  selector,
  key: sketchProfileSelectorKey(selector),
  label: index ? "Upper section" : "Lower section",
}))
const paths: PathSketchOption[] = project.sketches.map((sketch) => ({
  sketch,
  curves: sketch.entities.flatMap((entity) =>
    entity.type === "line"
      ? [
          {
            id: entity.id,
            label: entity.id,
            startPointId: entity.startPointId,
            endPointId: entity.endPointId,
          },
        ]
      : [],
  ),
  points: sketch.entities.flatMap((entity) =>
    entity.type === "point" ? [{ id: entity.id, label: entity.id }] : [],
  ),
}))
const support = bodyFaceRefSchema.parse({
  schemaVersion: 1,
  featureId: id(850),
  outputRole: "result",
  kind: "face",
  signature: {
    kind: "face",
    geometryClass: "PLANE",
    measure: 40,
    centroid: [0, -2, 5],
    bounds: { min: [-2, -2, 0], max: [2, -2, 10] },
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE"],
  },
})
const supports = [{ reference: support, key: loftSupportKey(support), label: "Seed box wall" }]
const parameters = {
  sections: project.sections,
  ruled: false,
  outerCorrespondence: project.outerCorrespondence,
  rails: [{ vertexTrack: 0, path: project.railPath }],
  guides: [{ name: "Wall", segmentTrack: 0, continuity: "C0", path: project.guidePath }],
  start: [{ segmentTrack: 0, continuity: "G1", support }],
  end: [{ segmentTrack: 0, continuity: "G2", support }],
}
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: loftFeatureTypeV3.type,
  parameters,
  dependencies: [id(850), id(851)],
  references: [],
  suppressed: false,
})
const renderForm = (form: ReactNode) =>
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>{form}</TooltipProvider>
    </I18nProvider>,
  )
afterEach(cleanup)
it("authors every directed section cell and persists rails, named C0 guides and independent end support intent", async () => {
  const onSave = vi.fn(async () => ({ ok: true as const }))
  renderForm(
    <SweepLoftForm
      copy={copy}
      mode={mode("loft")}
      baseRevision={project.snapshot.revision}
      snapshot={project.snapshot}
      profiles={profiles}
      paths={paths}
      supports={supports}
      variables={[]}
      onCancel={vi.fn()}
      onSaved={vi.fn()}
      onSave={onSave}
      previewStatus="ready"
    />,
  )
  for (const label of ["Lower section", "Upper section"]) {
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Section profile" }),
      screen.getByRole("option", { name: label }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Add section" }))
  }
  await userEvent.click(screen.getByRole("checkbox", { name: copy.constrained }))
  const apply = screen.getByRole("button", { name: copy.submit })
  expect(apply.hasAttribute("disabled")).toBe(true)
  await authorTracks()
  await authorPaths()
  await authorEnds()
  await userEvent.click(apply)
  expect(onSave).toHaveBeenCalledWith(
    project.snapshot.revision,
    expect.objectContaining({
      type: loftFeatureTypeV3.type,
      parameters,
      dependencies: [id(850), id(851)],
    }),
  )
})
it("retains unmatched authored end supports with explicit repair controls and keeps measured preview failures visible", () => {
  const edit = { kind: "edit" as const, operation: "loft" as const, feature }
  const values = sweepLoftFormValues(edit)
  expect(
    sweepLoftFeatureRecord(edit, feature.id, values, profiles, paths, project.snapshot, []),
  ).toBeNull()
  renderForm(
    <SweepLoftForm
      copy={copy}
      mode={edit}
      baseRevision={project.snapshot.revision}
      snapshot={project.snapshot}
      profiles={profiles}
      paths={paths}
      supports={[]}
      variables={[]}
      onCancel={vi.fn()}
      onSaved={vi.fn()}
      onSave={vi.fn()}
      previewStatus="error"
      previewDiagnostic="Loft G2 residual 0.01 exceeded curvature tolerance 0.0001"
    />,
  )
  expect(screen.getAllByRole("option", { name: copy.unavailableSupport })).toHaveLength(2)
  for (const select of screen.getAllByRole("combobox", { name: copy.supportFace }))
    expect((select as HTMLSelectElement).value).toBe(loftSupportKey(support))
  expect(screen.getByText(/residual 0.01 exceeded/)).toBeTruthy()
  expect(screen.getByRole("button", { name: copy.submit }).hasAttribute("disabled")).toBe(true)
})
it("remaps authored section cells without guessing correspondence for an inserted section", () => {
  const values = sweepLoftFormValues({ kind: "edit", operation: "loft", feature })
  const first = project.sections[0],
    second = project.sections[1]
  if (!first || !second) throw new Error("Required fixture sections")
  const added = sketchProfileSelectorSchema.parse({ ...first, sketchId: id(5000) })
  const reordered = remapLoftOuterTracks(
    values.outerCorrespondence,
    [first, second],
    [second, added, first],
  )
  expect(reordered[0]).toEqual({
    sectionEntityIds: [id(2011), "", id(1011)],
    sectionStartPointIds: [id(2001), "", id(1001)],
  })
  expect(sweepLoftFormValues({ kind: "edit", operation: "loft", feature }).guides).toEqual(
    values.guides,
  )
})

async function authorTracks() {
  for (let track = 0; track < 4; track++) {
    await userEvent.click(screen.getByRole("button", { name: copy.addTrack }))
    for (let section = 0; section < 2; section++)
      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: copy.directedSegment(track + 1, section + 1) }),
        `${project.outerCorrespondence[track]?.sectionEntityIds[section]}:${project.outerCorrespondence[track]?.sectionStartPointIds[section]}`,
      )
  }
}
async function authorPaths() {
  for (const [button, groupName, sketchLabel, path] of [
    [copy.addRail, copy.rail(1), "Corner rail", project.railPath],
    [copy.addGuide, copy.guide(1), "Wall guide", project.guidePath],
  ] as const) {
    await userEvent.click(screen.getByRole("button", { name: button }))
    const group = within(screen.getByRole("group", { name: groupName }))
    if (groupName === copy.guide(1))
      await userEvent.type(group.getByRole("textbox", { name: copy.guideName }), "Wall")
    await userEvent.selectOptions(
      group.getByRole("combobox", { name: copy.pathSketch }),
      group.getByRole("option", { name: sketchLabel }),
    )
    await userEvent.click(group.getByRole("checkbox", { name: path.entityIds[0] ?? "" }))
    await userEvent.selectOptions(
      group.getByRole("combobox", { name: copy.startPoint }),
      path.startPointId,
    )
  }
}
async function authorEnds() {
  for (const [title, continuity] of [
    [copy.startContinuity, "G1"],
    [copy.endContinuity, "G2"],
  ] as const) {
    const group = within(screen.getByRole("group", { name: title }))
    await userEvent.click(group.getByRole("button", { name: copy.addEnd }))
    await userEvent.selectOptions(
      group.getByRole("combobox", { name: copy.continuity }),
      continuity,
    )
    await userEvent.selectOptions(
      group.getByRole("combobox", { name: copy.supportFace }),
      supports[0]?.key ?? "",
    )
  }
}
