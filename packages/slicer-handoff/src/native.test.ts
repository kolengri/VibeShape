import { describe, expect, it } from "bun:test"
import { nativeMeshRequestSchema, nativeMeshResultSchema } from "./native"
import { MAX_SLICER_HANDOFF_BYTES } from "./protocol"

const request = {
  slicerId: "orca-slicer",
  format: "3mf",
  filename: "Part.3mf",
  file: new Uint8Array([80, 75, 3, 4]),
}
describe("native slicer mesh boundary", () => {
  it("accepts only owned byte arrays with a matching mesh filename and bounded size", () => {
    expect(nativeMeshRequestSchema.safeParse(request).success).toBe(true)
    expect(
      nativeMeshRequestSchema.safeParse({ ...request, filename: "Part.stl", format: "stl" })
        .success,
    ).toBe(true)
    for (const payload of [
      { ...request, filename: "../Part.3mf" },
      { ...request, filename: "Part.stl" },
      { ...request, filename: "Part\u0000.3mf" },
      { ...request, file: [80, 75, 3, 4] },
      { ...request, file: new Uint8Array() },
      { ...request, file: new Uint8Array(MAX_SLICER_HANDOFF_BYTES + 1) },
      { ...request, slicerId: "/Applications/Untrusted.app" },
      { ...request, executable: "/arbitrary/path" },
    ])
      expect(nativeMeshRequestSchema.safeParse(payload).success).toBe(false)
  })
  it("does not expose filesystem paths in native success or failure responses", () => {
    expect(
      nativeMeshResultSchema.safeParse({
        ok: false,
        reason: "launch-failed",
        fileId: "00000000-0000-4000-8000-000000000000",
      }).success,
    ).toBe(true)
    expect(
      nativeMeshResultSchema.safeParse({
        ok: false,
        reason: "launch-failed",
        path: "/private/mesh.3mf",
      }).success,
    ).toBe(false)
  })
})
