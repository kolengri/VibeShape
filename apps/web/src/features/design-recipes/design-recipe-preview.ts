import { type DesignRecipe, prepareDesignRecipeReplay } from "@vibeshape/application/design-recipes"
import { createDisposableDocumentPreview } from "@vibeshape/application/disposable-document-preview"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import { projectDocumentSnapshotV1ToV0 } from "@vibeshape/domain"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import {
  commitAuthoredTransaction,
  getDocumentControllerState,
  materializeActiveDocumentSourceAssets,
} from "../../document/document-controller"
import { PRODUCT_MESH_POLICY } from "../../document/document-worker-settings"

export async function previewDesignRecipe(recipe: DesignRecipe, signal: AbortSignal) {
  const state = getDocumentControllerState()
  const target = state.authoredSnapshot
  if (state.status !== "ready" || !target || state.report?.mode !== "read-write")
    throw new Error("Open a writable design before replaying a recipe.")
  const prepared = prepareDesignRecipeReplay(
    recipe,
    target,
    {
      transactionId: browserAuthoredUuid(),
      issuedAt: new Date().toISOString(),
      actor: { type: "user", userId: null },
    },
    browserAuthoredUuid,
  )
  if (!prepared.ok) throw new Error(prepared.message)
  const projected = projectDocumentSnapshotV1ToV0(prepared.model)
  if (!projected.ok) throw new Error(projected.diagnostic.message)
  const preview = createDisposableDocumentPreview({
    mesh: PRODUCT_MESH_POLICY,
    createRebuildPort: (id) =>
      createDocumentWorkerSession(id, {
        materializeSourceAssets: materializeActiveDocumentSourceAssets,
      }),
  })
  const cancel = () => preview.cancel()
  signal.addEventListener("abort", cancel, { once: true })
  try {
    if (signal.aborted) throw new Error("Recipe preview cancelled.")
    const result = await preview.preview(projected.snapshot)
    if (!result.ok) throw new Error(`Recipe preview failed: ${result.code}.`)
    if (!result.valid)
      throw new Error(
        "The recipe produces failed or blocked geometry. Correct the script before applying.",
      )
    if (signal.aborted) throw new Error("Recipe preview cancelled.")
    return { ...prepared, documentId: target.id, baseRevision: target.revision }
  } finally {
    signal.removeEventListener("abort", cancel)
    preview.dispose()
  }
}

export async function applyDesignRecipePreview(
  prepared: Awaited<ReturnType<typeof previewDesignRecipe>>,
) {
  const state = getDocumentControllerState()
  if (
    state.authoredSnapshot?.id !== prepared.documentId ||
    state.authoredSnapshot.revision !== prepared.baseRevision
  )
    throw new Error("The design changed after preview. Preview the script again.")
  const result = await commitAuthoredTransaction(prepared.baseRevision, prepared.transaction)
  if (!result.ok) throw new Error(result.diagnostic.message)
}
