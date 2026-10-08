import { describe, expect, it } from "bun:test"
import { documentIdSchema } from "@vibeshape/domain"
import {
  libraryDocumentScope,
  libraryDocumentWritable,
  librarySaveState,
  libraryScopeMatches,
  librarySelection,
  librarySources,
  libraryVersions,
  parseLibraryMetadata,
} from "./library-model"
import {
  libraryController,
  libraryItem,
  libraryRead,
  librarySourcePartId,
} from "./library-test-fixtures"

describe("local component library presentation authority", () => {
  it("derives available Part identities and frozen definitions from the existing assembly helpers", () => {
    const controller = libraryController()
    const sources = librarySources(controller)
    expect(sources).toHaveLength(4)
    expect(sources[0]).toMatchObject({
      kind: "part",
      name: "Part 1",
      id: librarySourcePartId,
    })
    expect(sources.at(-1)).toMatchObject({ kind: "definition", name: "Bracket definition" })
    const unavailable = {
      ...controller,
      report: { ...controller.report, rebuild: { ok: false } },
    } as typeof controller
    expect(librarySources(unavailable).every(({ kind }) => kind === "definition")).toBe(true)
  })
  it("never retains verified source byte blobs in selected UI state", () => {
    const read = libraryRead()
    expect(librarySelection(read)).toEqual({ item: read.item, version: read.version })
    expect(Object.hasOwn(librarySelection(read), "blobs")).toBe(false)
    expect(libraryVersions(libraryItem)).toEqual([2, 1])
  })
  it("validates optimistic metadata with bounded distinct tags and preserves entered case", () => {
    expect(parseLibraryMetadata("Reusable mount", " Print, Mount , ")).toMatchObject({
      success: true,
      data: { name: "Reusable mount", tags: ["Print", "Mount"] },
    })
    expect(parseLibraryMetadata("", "Print").success).toBe(false)
    expect(parseLibraryMetadata("Mount", "Print, print").success).toBe(false)
    expect(parseLibraryMetadata("Mount", "a".repeat(65)).success).toBe(false)
    expect(
      parseLibraryMetadata("Mount", Array.from({ length: 33 }, (_, n) => `tag${n}`).join(","))
        .success,
    ).toBe(false)
  })
  it("separates browsing from guarded writable document mutations", () => {
    const controller = libraryController()
    expect(libraryDocumentScope(controller)).toEqual<unknown>({
      documentId: controller.authoredSnapshot?.id,
      revision: controller.authoredSnapshot?.revision,
    })
    expect(libraryDocumentWritable(controller, false)).toBe(true)
    expect(libraryDocumentWritable(controller, true)).toBe(false)
    expect(libraryDocumentWritable({ ...controller, saveStatus: "saving" }, false)).toBe(false)
  })
  it("requires an explicit publication target and keeps its optimistic revision separate from immutable content", () => {
    const sources = librarySources(libraryController())
    const source = sources[0]
    if (!source) throw new Error("The fixture requires an available source.")
    expect(
      librarySaveState(sources, source.key, false, librarySelection(libraryRead())),
    ).toMatchObject({ target: null, name: source.name, disabled: false })
    expect(librarySaveState(sources, source.key, true, null).disabled).toBe(true)
    expect(librarySaveState(sources, "missing-source", false, null).disabled).toBe(true)
    expect(
      librarySaveState(sources, source.key, true, librarySelection(libraryRead())),
    ).toMatchObject({
      target: libraryItem,
      name: "Bracket",
      tags: ["Print", "Mount"],
      disabled: false,
    })
    const scope = libraryDocumentScope(libraryController())
    expect(libraryScopeMatches(scope, { ...scope, revision: 8 }, true)).toBe(false)
    expect(libraryScopeMatches(scope, { ...scope, revision: 8 }, false)).toBe(true)
    expect(
      libraryScopeMatches(
        scope,
        { documentId: documentIdSchema.parse("0195b5ac-b220-7a2c-8c33-000000000999"), revision: 7 },
        false,
      ),
    ).toBe(false)
  })
})
