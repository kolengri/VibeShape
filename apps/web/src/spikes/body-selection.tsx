import {
  boxFeatureType,
  defaultDocumentDisplayUnits,
  featureIdSchema,
  featureRecordSchema,
} from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { type ReactNode, useCallback, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import type { DocumentControllerState } from "../document/document-controller"
import { DocumentDisplayUnitsProvider } from "../document/document-display-units"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import { i18n } from "../i18n"
import { GeometryViewport } from "../shell/geometry-viewport"
import { ModelTree } from "../shell/model-tree"
import type { EditorWorkspaceName } from "../shell/workspace"
import "../styles.css"

const featureId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f4201")
const contentHash = "a".repeat(64)
const bodyRoles = ["pattern.instance.0", "pattern.instance.1"] as const

type BodyRole = (typeof bodyRoles)[number]

type BodySelectionFixtureState = Readonly<{
  pickedRole: string | null
  preselectedRole: string | null
  selectedRole: string | null
  removedRole: string | null
  revision: number
}>

declare global {
  interface Window {
    __VIBESHAPE_BODY_SELECTION__: BodySelectionFixtureState
  }
}

function cubeMesh(centerX: number) {
  const x0 = centerX - 5
  const x1 = centerX + 5
  const y0 = -5
  const y1 = 5
  const z0 = 0
  const z1 = 10
  const positions = new Float32Array([
    x0,
    y0,
    z0,
    x1,
    y0,
    z0,
    x1,
    y1,
    z0,
    x0,
    y1,
    z0,
    x0,
    y0,
    z1,
    x1,
    y0,
    z1,
    x1,
    y1,
    z1,
    x0,
    y1,
    z1,
  ])
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7,
    4, 3, 4, 0,
  ])
  const normals = new Float32Array(positions.length)
  const triangleFaceIds = new Uint32Array(indices.length / 3).fill(0)
  return { positions, normals, indices, triangleFaceIds }
}

const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: featureId,
  type: boxFeatureType.type,
  parameters: {
    width: { value: 10, unit: "mm" },
    depth: { value: 10, unit: "mm" },
    height: { value: 10, unit: "mm" },
    centered: false,
  },
  dependencies: [],
  references: [],
  suppressed: false,
  label: "Sibling body fixture",
})

function fixtureController(removedRole: BodyRole | null, revision: number) {
  const bodies = bodyRoles
    .filter((outputRole) => outputRole !== removedRole)
    .map((outputRole, index) => ({
      outputRole,
      shape: { solidCount: 1 },
      mesh: cubeMesh(index === 0 ? -15 : 15),
      topologyCandidates: [],
    }))
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      status: "created",
      mode: "read-write",
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: null,
      snapshot: {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f4202",
        revision,
        name: "Body selection fixture",
        variables: [],
        sketches: [],
        features: [feature],
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
      },
      rebuild: {
        ok: true,
        response: {
          type: "documentRebuilt",
          documentId: "0195b5ac-b220-7a2c-8c33-67a36a7f4202",
          revision,
          evaluation: {
            records: [{ featureId, status: "succeeded", contentHash }],
            dirtyFeatureIds: [],
            evaluatedFeatureIds: [featureId],
            reusedFeatureIds: [],
          },
          geometry: [
            {
              featureId,
              contentHash,
              meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
              geometry: {
                shape: { solidCount: bodies.length },
                mesh: bodies[0]?.mesh ?? cubeMesh(0),
                topologyCandidates: [],
                bodies,
              },
            },
          ],
          sketches: [],
          modelReferenceEvidence: [],
        },
      },
    },
  } as unknown as DocumentControllerState
}

function noop() {}

function isBodyRole(value: string | undefined): value is BodyRole {
  return value === bodyRoles[0] || value === bodyRoles[1]
}

function FixtureTree({
  controller,
  selectedBody,
  onBodyActivate,
  onBodyPreselectionChange,
}: Readonly<{
  controller: DocumentControllerState
  selectedBody: ModelBodySelection | null
  onBodyActivate: (selection: ModelBodySelection) => void
  onBodyPreselectionChange: (selection: ModelBodySelection | null) => void
}>) {
  return (
    <ModelTree
      activeWorkspace={"modeling" as EditorWorkspaceName}
      activeFeatureId={null}
      activeSketchId={null}
      controller={controller}
      hiddenFeatureIds={[]}
      hiddenSketchIds={[]}
      activeBody={selectedBody}
      onBodyActivate={onBodyActivate}
      onBodyPreselectionChange={onBodyPreselectionChange}
      onFeatureActivate={noop}
      onFeaturePreselectionChange={noop}
      onFeatureVisibilityChange={noop}
      onFeatureRename={async () => ({ ok: true as const })}
      onSketchActivate={noop}
      onSketchSupportRepair={noop}
      onAllSketchVisibilityToggle={noop}
      onSketchDeleted={noop}
      onSketchRemove={async () => ({ ok: true as const })}
      onSketchRename={async () => ({ ok: true as const })}
      onSketchVisibilityChange={noop}
      onWorkspaceChange={noop}
      sketchRenameBlockedId={null}
    />
  )
}

function useFixtureSelections() {
  const [selectedBody, setSelectedBody] = useState<ModelBodySelection | null>(null)
  const [preselectedBody, setPreselectedBody] = useState<ModelBodySelection | null>(null)
  const [faceSelection, setFaceSelection] = useState<ViewerSelection | null>(null)
  const activateBody = useCallback((selection: ModelBodySelection) => {
    setSelectedBody(selection)
    setFaceSelection(null)
  }, [])
  const onFaceSelectionChange = useCallback((selection: ViewerSelection | null) => {
    setFaceSelection(selection)
    setSelectedBody(null)
  }, [])
  const onBodySelectionChange = useCallback((selection: ModelBodySelection | null) => {
    setSelectedBody(selection)
    if (selection === null) setFaceSelection(null)
  }, [])
  return {
    activateBody,
    faceSelection,
    onBodySelectionChange,
    onFaceSelectionChange,
    preselectedBody,
    selectedBody,
    setPreselectedBody,
  }
}

function useFixtureRebuild(selectedBody: ModelBodySelection | null) {
  const [removedRole, setRemovedRole] = useState<BodyRole | null>(null)
  const [revision, setRevision] = useState(1)
  const controller = useMemo(
    () => fixtureController(removedRole, revision),
    [removedRole, revision],
  )
  const removeSelectedBody = useCallback(() => {
    const role = selectedBody?.outputRole
    if (!isBodyRole(role)) return
    setRemovedRole(role)
    setRevision((value) => value + 1)
  }, [selectedBody])
  const restoreBodies = useCallback(() => {
    setRemovedRole(null)
    setRevision((value) => value + 1)
  }, [])
  return { controller, removeSelectedBody, removedRole, restoreBodies, revision }
}

function optionalOutputRole(body: Readonly<{ outputRole?: string }> | null) {
  return body?.outputRole ?? null
}

function fixtureObservationState(
  faceSelection: ViewerSelection | null,
  preselectedBody: ModelBodySelection | null,
  selectedBody: ModelBodySelection | null,
  removedRole: BodyRole | null,
  revision: number,
): BodySelectionFixtureState {
  return {
    pickedRole: optionalOutputRole(faceSelection),
    preselectedRole: optionalOutputRole(preselectedBody),
    selectedRole: optionalOutputRole(selectedBody),
    removedRole,
    revision,
  }
}

function useBodySelectionFixture() {
  const selections = useFixtureSelections()
  const rebuild = useFixtureRebuild(selections.selectedBody)
  return {
    ...rebuild,
    ...selections,
    state: fixtureObservationState(
      selections.faceSelection,
      selections.preselectedBody,
      selections.selectedBody,
      rebuild.removedRole,
      rebuild.revision,
    ),
  }
}

function FixtureControls({
  canRemove,
  onRemove,
  onRestore,
}: Readonly<{
  canRemove: boolean
  onRemove: () => void
  onRestore: () => void
}>) {
  return (
    <div className="absolute left-3 top-3 z-20 flex gap-2 rounded-md border bg-background/90 p-2 shadow-sm">
      <button
        type="button"
        data-testid="remove-selected-body"
        disabled={!canRemove}
        onClick={onRemove}
      >
        Remove selected body
      </button>
      <button type="button" data-testid="restore-bodies" onClick={onRestore}>
        Restore bodies
      </button>
    </div>
  )
}

function FixtureViewport({
  controller,
  faceSelection,
  onBodySelectionChange,
  onFaceSelectionChange,
  preselectedBody,
  selectedBody,
}: Readonly<{
  controller: DocumentControllerState
  faceSelection: ViewerSelection | null
  onBodySelectionChange: (selection: ModelBodySelection | null) => void
  onFaceSelectionChange: (selection: ViewerSelection | null) => void
  preselectedBody: ModelBodySelection | null
  selectedBody: ModelBodySelection | null
}>) {
  return (
    <GeometryViewport
      controller={controller}
      selection={faceSelection}
      onSelectionChange={onFaceSelectionChange}
      selectedBody={selectedBody}
      preselectedBody={preselectedBody}
      onBodySelectionChange={onBodySelectionChange}
    />
  )
}

function BodySelectionFixture() {
  const fixture = useBodySelectionFixture()
  window.__VIBESHAPE_BODY_SELECTION__ = fixture.state

  return (
    <main className="grid h-screen min-h-0 grid-cols-[18rem_minmax(0,1fr)] bg-background text-foreground">
      <FixtureTree
        controller={fixture.controller}
        selectedBody={fixture.selectedBody}
        onBodyActivate={fixture.activateBody}
        onBodyPreselectionChange={fixture.setPreselectedBody}
      />
      <div className="relative grid min-h-0">
        <FixtureControls
          canRemove={fixture.selectedBody !== null}
          onRemove={fixture.removeSelectedBody}
          onRestore={fixture.restoreBodies}
        />
        <FixtureViewport
          controller={fixture.controller}
          faceSelection={fixture.faceSelection}
          onBodySelectionChange={fixture.onBodySelectionChange}
          onFaceSelectionChange={fixture.onFaceSelectionChange}
          preselectedBody={fixture.preselectedBody}
          selectedBody={fixture.selectedBody}
        />
      </div>
    </main>
  )
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider i18n={i18n}>
      <TooltipProvider delayDuration={0}>
        <DocumentDisplayUnitsProvider displayUnits={defaultDocumentDisplayUnits}>
          {children}
        </DocumentDisplayUnitsProvider>
      </TooltipProvider>
    </I18nProvider>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("The body selection fixture root is missing.")
createRoot(root).render(
  <Providers>
    <BodySelectionFixture />
  </Providers>,
)
