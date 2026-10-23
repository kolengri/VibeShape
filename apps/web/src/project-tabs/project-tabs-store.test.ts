import { describe, expect, it } from "bun:test"
import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { createProjectTabsStore } from "./project-tabs-store"

const first = {
  documentId: documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000101"),
  name: "Bracket",
}
const second = {
  documentId: documentIdSchema.parse("0195b5ac-b250-7a2c-8c33-000000000102"),
  name: "Enclosure",
}
function storage(raw?: string) {
  let value = raw ?? null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
  }
}

describe("open project tab preferences", () => {
  it("restores stable IDs and cached names without persisting transition state", () => {
    const local = storage()
    const store = createProjectTabsStore(local)
    store.getState().actions.remember(first)
    store.getState().actions.remember(second)
    store.getState().actions.beginTransition()
    store.getState().actions.replaceOnActivation(second.documentId)
    const restored = createProjectTabsStore(local).getState()
    expect(restored.tabs).toEqual([first, second])
    expect(restored.pending).toBe(false)
    expect(restored.replacingDocumentId).toBeNull()
    expect(JSON.parse(local.getItem() ?? "null")).toEqual({ version: 1, tabs: [first, second] })
  })

  it.each([
    "invalid JSON",
    JSON.stringify({ version: 2, tabs: [first] }),
    JSON.stringify({ version: 1, tabs: [first, first] }),
    JSON.stringify({ version: 1, tabs: [{ ...first, documentId: "untrusted" }] }),
    JSON.stringify({ version: 1, tabs: [{ ...first, name: " " }] }),
    JSON.stringify({ version: 1, tabs: [first], model: {} }),
    " ".repeat(262_145),
  ])("ignores invalid persisted open-list data", (value) => {
    expect(createProjectTabsStore(storage(value)).getState().tabs).toEqual([])
  })

  it("updates a renamed tab without duplicating or reordering open projects", () => {
    const store = createProjectTabsStore(storage())
    store.getState().actions.remember(first)
    store.getState().actions.remember(second)
    store.getState().actions.remember({ ...first, name: "Mounting bracket" })
    expect(store.getState().tabs).toEqual([{ ...first, name: "Mounting bracket" }, second])
  })

  it("reconciles deleted projects and current labels only after a successful library read", () => {
    const store = createProjectTabsStore(storage())
    store.getState().actions.remember(first)
    store.getState().actions.remember(second)
    store.getState().actions.reconcile([{ ...first, name: "Bracket v2" }], first)
    expect(store.getState().tabs).toEqual([first])
    store.getState().actions.reconcile([], first)
    expect(store.getState().tabs).toEqual([first])
  })

  it("retains the final project until replacement activation and supports cancellation", () => {
    const store = createProjectTabsStore(storage())
    store.getState().actions.remember(first)
    store.getState().actions.replaceOnActivation(first.documentId)
    store.getState().actions.remember(first)
    expect(store.getState().tabs).toEqual([first])
    store.getState().actions.replaceOnActivation(null)
    store.getState().actions.remember(second)
    expect(store.getState().tabs).toEqual([first, second])
    store.getState().actions.remove(second.documentId)
    store.getState().actions.replaceOnActivation(first.documentId)
    store.getState().actions.remember(second)
    expect(store.getState().tabs).toEqual([second])
    expect(store.getState().focusRequested).toBe(true)
  })

  it("retains usable tabs when local preference writes fail", () => {
    const store = createProjectTabsStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("denied")
      },
    })
    store.getState().actions.remember(first)
    expect(store.getState().tabs).toEqual([first])
    expect(store.getState().storageFailed).toBe(true)
  })

  it("keeps independent scopes isolated and prevents concurrent navigation", () => {
    const firstScope = createProjectTabsStore(storage())
    const secondScope = createProjectTabsStore(storage())
    firstScope.getState().actions.remember(first)
    expect(secondScope.getState().tabs).toEqual([])
    const token = firstScope.getState().actions.beginTransition()
    expect(token).not.toBeNull()
    expect(firstScope.getState().actions.beginTransition()).toBeNull()
    if (token !== null) firstScope.getState().actions.endTransition(token)
    expect(firstScope.getState().actions.beginTransition()).not.toBeNull()
  })
  it("keeps the latest selection locked when an older attempt settles", () => {
    const store = createProjectTabsStore(storage())
    const firstAttempt = store.getState().actions.beginTransition("selection", first.documentId)
    const secondAttempt = store.getState().actions.beginTransition("selection", second.documentId)
    if (firstAttempt === null || secondAttempt === null)
      throw new Error("Expected both selections to start.")
    store.getState().actions.endTransition(firstAttempt)
    store.getState().actions.markClosing(firstAttempt)
    expect(store.getState().pending).toBe(true)
    expect(store.getState().closing).toBe(false)
    expect(store.getState().pendingProjectId).toBe(second.documentId)
    expect(store.getState().actions.beginTransition("selection", second.documentId)).toBeNull()
    store.getState().actions.markClosing(secondAttempt)
    expect(store.getState().actions.beginTransition("selection", first.documentId)).toBeNull()
    store.getState().actions.endTransition(secondAttempt)
    expect(store.getState().pending).toBe(false)
    expect(store.getState().closing).toBe(false)
  })
})
