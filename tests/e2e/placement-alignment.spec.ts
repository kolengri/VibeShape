import type { ResolvedAuthoredPart } from "../../packages/application/src/authored-parts"
import type {
  DocumentRebuildOutcome,
  PersistentDocumentSessionReport,
} from "../../packages/application/src/persistent-document-session"
import type { BodyReference } from "../../packages/domain/src/body-reference"
import type { DocumentSnapshot } from "../../packages/domain/src/document"
import { saved } from "./authored-parts-ui-support"
import { expect, test } from "./fixtures"

// Browser modules are loaded in page.evaluate; keep their inspection types DOM-independent.
type InspectionState = Readonly<{ report: PersistentDocumentSessionReport | null }>
type ControllerModule = Readonly<{ getDocumentControllerState: () => InspectionState }>
type PartsModule = Readonly<{
  currentAuthoredParts: (state: InspectionState) => readonly ResolvedAuthoredPart[]
}>
type InspectionFace = Readonly<{
  key: string
  candidateId: string
  center: readonly [number, number, number]
  normal: readonly [number, number, number]
}>
type AlignmentModule = Readonly<{
  placementAlignmentFaces: (
    snapshot: DocumentSnapshot,
    rebuild: DocumentRebuildOutcome,
    source: BodyReference,
    parts: readonly ResolvedAuthoredPart[],
  ) => Readonly<{ source: readonly InspectionFace[]; targets: readonly InspectionFace[] }>
}>

const paths = {
  controller: "/src/document/document-controller.ts",
  parts: "/src/shell/authored-tree-state.ts",
  alignment: "/src/features/placement/placement-face-alignment.ts",
}

test("picks a committed moving face and saves one exact face alignment with Undo", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/")
  await saved(page)
  const commands = page.getByRole("toolbar", { name: "Model commands" })
  await commands.getByRole("button", { name: "Box", exact: true }).click()
  await page
    .getByRole("form", { name: "Create box", exact: true })
    .getByRole("button", { name: "Create box", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: "Part Box 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await commands.getByRole("button", { name: "Place / align faces", exact: true }).click()
  let form = page.getByRole("form", { name: "Place part", exact: true })
  await form.locator("summary").click()
  const viewport = page.getByRole("region", { name: "3D viewport", exact: true })
  await expect(viewport).toHaveAttribute("data-preview-status", "ready", { timeout: 30_000 })
  await form.getByRole("button", { name: "Pick faces in viewport", exact: true }).click()
  await expect(viewport).toHaveAttribute("data-preview-status", "idle")
  const bounds = await viewport.boundingBox()
  if (!bounds) throw new Error("The authoring viewport must be visible.")
  // The default box's visible side is well inside its projected face, away from shared edges.
  await page.mouse.click(bounds.x + bounds.width * 0.43, bounds.y + bounds.height * 0.44)
  const useMoving = form.getByRole("button", { name: "Use selected moving face", exact: true })
  await expect(useMoving).toBeEnabled()
  await useMoving.click()
  await expect(form.getByLabel("Moving face", { exact: true })).not.toHaveValue("")
  await expect(form.getByRole("button", { name: "Create placement", exact: true })).toBeDisabled()
  await form.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Placement 1", exact: true })).toHaveCount(0)

  await commands.getByRole("button", { name: "Cylinder", exact: true }).click()
  await page
    .getByRole("form", { name: "Create cylinder", exact: true })
    .getByRole("button", { name: "Create cylinder", exact: true })
    .click()
  await expect(page.getByRole("treeitem", { name: "Part Cylinder 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  await page.getByRole("treeitem", { name: "Part Box 1", exact: true }).click()
  await commands.getByRole("button", { name: "Place / align faces", exact: true }).click()
  form = page.getByRole("form", { name: "Place part", exact: true })
  const before = await page.evaluate(async (modules) => {
    const controller: ControllerModule = await import(modules.controller)
    const parts: PartsModule = await import(modules.parts)
    const alignment: AlignmentModule = await import(modules.alignment)
    const state = controller.getDocumentControllerState()
    const report = state.report
    if (!report?.rebuild.ok) throw new Error("Committed exact geometry must be available.")
    const resolved = parts.currentAuthoredParts(state)
    const moving = resolved.find(({ part }) => part.name === "Box 1")
    if (!moving?.body) throw new Error("The moving part must have one current body.")
    const source = {
      schemaVersion: 0 as const,
      featureId: moving.body.featureId,
      outputRole: moving.body.outputRole ?? "result",
    }
    const catalog = alignment.placementAlignmentFaces(
      report.snapshot,
      report.rebuild,
      source,
      resolved,
    )
    const positiveZ = (face: (typeof catalog.source)[number]) => face.normal[2] > 0.999999
    const movingFace = catalog.source.find(positiveZ)
    const targetFace = catalog.targets.find(positiveZ)
    const stale = structuredClone(report.rebuild)
    stale.response.revision += 1
    const hidden = resolved.map((value) =>
      value === moving ? value : { ...value, part: { ...value.part, visible: false } },
    )
    const upstream = resolved.map((value) =>
      value === moving ? value : { ...value, status: "upstream" as const },
    )
    const wrongRole = resolved.map((value) =>
      value === moving || !value.body
        ? value
        : { ...value, body: { ...value.body, outputRole: "missing.role" } },
    )
    const ambiguous = structuredClone(report.rebuild)
    const body = ambiguous.response.geometry
      .find(({ featureId }) => featureId === source.featureId)
      ?.geometry.bodies?.find(({ outputRole }) => outputRole === source.outputRole)
    const faces = body?.topologyCandidates.filter(({ kind }) => kind === "face")
    const first = faces?.[0]
    const second = faces?.[1]
    if (!first || !second) throw new Error("The box must expose multiple faces.")
    first.semanticRole = undefined
    first.lineageTokens = []
    second.semanticRole = undefined
    second.lineageTokens = []
    second.signature = structuredClone(first.signature)
    const ambiguousFaces = alignment.placementAlignmentFaces(
      report.snapshot,
      ambiguous,
      source,
      resolved,
    ).source
    return {
      revision: report.snapshot.revision,
      partId: moving.part.id,
      sourceFeatureId: source.featureId,
      featureCount: report.snapshot.features.length,
      sourceVolume: moving.body.shape.volume,
      movingFace,
      targetFace,
      stale: alignment.placementAlignmentFaces(report.snapshot, stale, source, resolved),
      hiddenTargetCount: alignment.placementAlignmentFaces(
        report.snapshot,
        report.rebuild,
        source,
        hidden,
      ).targets.length,
      upstreamTargetCount: alignment.placementAlignmentFaces(
        report.snapshot,
        report.rebuild,
        source,
        upstream,
      ).targets.length,
      wrongRoleTargetCount: alignment.placementAlignmentFaces(
        report.snapshot,
        report.rebuild,
        source,
        wrongRole,
      ).targets.length,
      ambiguousCandidateIds: ambiguousFaces.map(({ candidateId }) => candidateId),
      rejectedCandidateIds: [first.candidateId, second.candidateId],
    }
  }, paths)
  expect(before.movingFace).toBeDefined()
  expect(before.targetFace).toBeDefined()
  if (!before.movingFace || !before.targetFace)
    throw new Error("Both solids must expose exact positive-Z planar caps.")
  const targetFace = before.targetFace
  expect(before.stale).toEqual({ source: [], targets: [] })
  expect([
    before.hiddenTargetCount,
    before.upstreamTargetCount,
    before.wrongRoleTargetCount,
  ]).toEqual([0, 0, 0])
  for (const id of before.rejectedCandidateIds)
    expect(before.ambiguousCandidateIds).not.toContain(id)
  await form.getByLabel("Moving face", { exact: true }).selectOption(before.movingFace.key)
  await form
    .getByLabel("Target face on another part", { exact: true })
    .selectOption(before.targetFace.key)
  await form.getByRole("combobox", { name: "Face offset", exact: true }).fill("2 mm")
  await form.getByRole("button", { name: "Calculate face alignment", exact: true }).click()
  await expect(form.getByRole("button", { name: "Create placement", exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await form.getByRole("button", { name: "Create placement", exact: true }).click()
  await expect(page.getByRole("treeitem", { name: "Placement 1", exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await saved(page)
  const after = await page.evaluate(async (modules) => {
    const controller: ControllerModule = await import(modules.controller)
    const parts: PartsModule = await import(modules.parts)
    const state = controller.getDocumentControllerState()
    const report = state.report
    if (!report?.rebuild.ok) throw new Error("Placement must rebuild before acceptance.")
    const feature = report.snapshot.features.find(({ label }) => label === "Placement 1")
    const part = parts.currentAuthoredParts(state).find(({ part }) => part.name === "Box 1")
    return {
      revision: report.snapshot.revision,
      featureCount: report.snapshot.features.length,
      feature,
      partId: part?.part.id,
      body: part?.body,
    }
  }, paths)
  expect(after.revision).toBe(before.revision + 1)
  expect(after.featureCount).toBe(before.featureCount + 1)
  expect(after.partId).toBe(before.partId)
  expect(after.feature?.dependencies).toEqual([before.sourceFeatureId])
  expect(after.feature?.references).toEqual([])
  expect(after.body?.shape.valid).toBe(true)
  expect(after.body?.shape.solidCount).toBe(1)
  expect(after.body?.shape.volume).toBeCloseTo(before.sourceVolume, 6)
  const expectedCenter = targetFace.center.map(
    (value, axis) => value + 2 * (targetFace.normal[axis] as number),
  )
  const alignedFace = after.body?.topologyCandidates.find(
    ({ signature }) =>
      signature.geometryClass === "PLANE" &&
      signature.centroid.every(
        (value, axis) => Math.abs(value - (expectedCenter[axis] as number)) < 1e-6,
      ),
  )
  expect(alignedFace).toBeDefined()
  for (const [axis, normal] of before.targetFace.normal.entries())
    expect(alignedFace?.signature.direction?.[axis]).toBeCloseTo(-normal, 6)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await saved(page)
  await expect(page.getByRole("treeitem", { name: "Placement 1", exact: true })).toHaveCount(0)
  const undone = await page.evaluate(async (modules) => {
    const controller: ControllerModule = await import(modules.controller)
    const parts: PartsModule = await import(modules.parts)
    const state = controller.getDocumentControllerState()
    const moving = parts.currentAuthoredParts(state).find(({ part }) => part.name === "Box 1")
    return {
      featureCount: state.report?.snapshot.features.length,
      partId: moving?.part.id,
      featureId: moving?.body?.featureId,
    }
  }, paths)
  expect(undone).toEqual({
    featureCount: before.featureCount,
    partId: before.partId,
    featureId: before.sourceFeatureId,
  })
})
