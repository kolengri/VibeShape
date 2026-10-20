import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { useLayoutEffect } from "react"
import { surfaceTextureProjectFixture } from "../../../../../tests/fixtures/surface-texture-project"
import type { DocumentControllerState } from "../../document/document-controller"
import {
  SurfaceTexturePreviewProvider,
  useSurfaceTexturePreviewContext,
} from "./surface-texture-preview-context"
import { useTexturedMeshes } from "./use-textured-meshes"

const fixture = surfaceTextureProjectFixture()
const sources: readonly ViewerMesh[] = []
const controller = {
  authoredSnapshot: fixture.snapshot,
  report: { snapshot: { id: fixture.snapshot.id, revision: fixture.snapshot.revision } },
} as unknown as DocumentControllerState

function DraftState() {
  const context = useSurfaceTexturePreviewContext()
  const setDraft = context?.setDraft
  const setStatus = context?.setStatus
  useLayoutEffect(() => {
    setStatus?.("ready")
    setDraft?.({
      documentId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      featureId: fixture.layer.featureId,
      layers: [fixture.layer],
    })
  }, [setDraft, setStatus])
  return <p data-testid="texture-status">{context?.status}</p>
}

function Meshes({ committedOnly }: { committedOnly?: boolean }) {
  const meshes = useTexturedMeshes(controller, sources, committedOnly)
  return (
    <p data-testid="texture-source">{meshes === sources ? "original buffers" : "draft buffers"}</p>
  )
}

afterEach(cleanup)

describe("committed texture presentation", () => {
  it("ignores a matching current draft and leaves its status untouched for checkpoint display", () => {
    render(
      <SurfaceTexturePreviewProvider active>
        <DraftState />
        <Meshes committedOnly />
      </SurfaceTexturePreviewProvider>,
    )
    expect(screen.getByTestId("texture-status").textContent).toBe("ready")
    expect(screen.getByTestId("texture-source").textContent).toBe("original buffers")
  })

  it("retains draft preview behavior when committed-only mode is omitted", async () => {
    const view = render(
      <SurfaceTexturePreviewProvider active>
        <DraftState />
        <Meshes />
      </SurfaceTexturePreviewProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("texture-status").textContent).toBe("loading"))
    view.unmount()
  })
})
