import { describe, expect, it } from "vitest"
import {
  correctOpenCascadeJsDestructorPolicy,
  createConfiguredBindingSymbols,
} from "./occt-builder-context"

const upstreamPolicy = `before
    nonPublicDestructor = any(x.kind == clang.cindex.CursorKind.DESTRUCTOR and not x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC for x in theClass.get_children())
    placementDelete = next((x for x in theClass.get_children() if x.spelling == "operator delete" and len(list(x.get_arguments())) == 2), None) is not None
    if nonPublicDestructor or placementDelete:
      output += "no-op"
after
`

describe(correctOpenCascadeJsDestructorPolicy.name, () => {
  it("keeps no-op destruction only when ordinary public deletion is unavailable", () => {
    const corrected = correctOpenCascadeJsDestructorPolicy(upstreamPolicy)

    expect(corrected).toContain("publicOrdinaryDelete = next")
    expect(corrected).toContain(
      "if nonPublicDestructor or (placementDelete and not publicOrdinaryDelete):",
    )
    expect(corrected).not.toContain("if nonPublicDestructor or placementDelete:")
  })

  it("rejects a changed or missing upstream policy", () => {
    expect(() => correctOpenCascadeJsDestructorPolicy("unrelated source")).toThrow(
      "Expected exactly one OpenCascade.js destructor-policy anchor.",
    )
  })

  it("rejects duplicate policy anchors", () => {
    expect(() =>
      correctOpenCascadeJsDestructorPolicy(`${upstreamPolicy}${upstreamPolicy}`),
    ).toThrow("Expected exactly one OpenCascade.js destructor-policy anchor.")
  })
})

describe(createConfiguredBindingSymbols.name, () => {
  it("creates a sorted, unique allowlist from every configured build", () => {
    expect(
      createConfiguredBindingSymbols(`mainBuild:
  bindings:
  - symbol: TopoDS_Shape
  - symbol: BRepPrimAPI_MakeBox
extraBuilds:
- bindings:
  - symbol: TopoDS_Shape
  - symbol: VibeShapeOcctDiagnostics
`),
    ).toEqual(["BRepPrimAPI_MakeBox", "TopoDS_Shape", "VibeShapeOcctDiagnostics"])
  })

  it("rejects a config without an explicit binding contract", () => {
    expect(() => createConfiguredBindingSymbols("mainBuild: {}\n")).toThrow(
      "does not declare any binding symbols",
    )
  })
})
