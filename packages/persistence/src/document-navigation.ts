import {
  canonicalJson,
  type DocumentAuthorityEvent,
  type DocumentAuthoritySnapshot,
} from "@vibeshape/domain"
import { persistenceInvariantError } from "./diagnostics"
import type { DocumentNavigation } from "./schemas"

function content(snapshot: DocumentAuthoritySnapshot) {
  const { revision: _revision, updatedAt: _updatedAt, ...value } = snapshot
  return canonicalJson(value)
}

type RestoreEvent = Extract<DocumentAuthorityEvent, { type: "org.vibeshape.document.restored" }>

function targetIndex(source: DocumentNavigation["undo"], event: RestoreEvent) {
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const entry = source[index]
    if (entry && (event.direction === "undo" ? entry.before : entry.after) === event.targetRevision)
      return index
  }
  return -1
}

function restoredNavigation(
  state: DocumentNavigation,
  before: DocumentAuthoritySnapshot,
  event: RestoreEvent,
  checkpointRestore: boolean,
  hasMetadata: boolean,
) {
  if (checkpointRestore) {
    if (event.direction !== "undo")
      throw persistenceInvariantError("invalid-input", "An internal checkpoint must restore Undo.")
    return {
      schemaVersion: 1 as const,
      undo: state.undo.filter((entry) => entry.after <= event.targetRevision),
      redo: [{ before: event.targetRevision, after: before.revision }],
    }
  }
  // Old clients and imported journals have no evidenced navigation ownership.
  if (!hasMetadata) return state
  const source = event.direction === "undo" ? state.undo : state.redo
  const destination = event.direction === "undo" ? state.redo : state.undo
  const index = targetIndex(source, event)
  if (index < 0)
    throw persistenceInvariantError(
      "invalid-input",
      "The restore target is not in the saved navigation stack.",
    )
  for (const entry of source.splice(index).reverse()) destination.push(entry)
  return state
}

export function nextDocumentNavigation(
  previous: DocumentNavigation | undefined,
  before: DocumentAuthoritySnapshot | null,
  after: DocumentAuthoritySnapshot,
  events: readonly DocumentAuthorityEvent[],
  checkpointRestore = false,
  historyBase = before,
): DocumentNavigation {
  const state: DocumentNavigation = {
    schemaVersion: 1,
    undo: [...(previous?.undo ?? [])],
    redo: [...(previous?.redo ?? [])],
  }
  const event = events.length === 1 ? events[0] : undefined
  if (checkpointRestore && event?.type !== "org.vibeshape.document.restored")
    throw persistenceInvariantError(
      "invalid-input",
      "Only a restore can publish an internal checkpoint.",
    )
  if (!before) return state
  if (event?.type === "org.vibeshape.document.restored")
    return restoredNavigation(state, before, event, checkpointRestore, previous !== undefined)
  if (
    before.schemaVersion !== after.schemaVersion &&
    after.schemaVersion !== 5 &&
    after.schemaVersion !== 6
  ) {
    state.undo = []
    state.redo = []
  }
  if (historyBase && content(historyBase) !== content(after)) {
    state.undo.push({ before: historyBase.revision, after: after.revision })
    state.redo = []
  }
  return state
}
