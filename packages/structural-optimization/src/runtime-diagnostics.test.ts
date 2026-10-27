import { describe, expect, it } from "bun:test"
import { z } from "zod"
import { numericalRuntimeMessage } from "./runtime-diagnostics"

describe("bounded numerical worker runtime diagnostics", () => {
  it("redacts sensitive URLs in schema issue messages and paths", () => {
    const url = "https://user:secret@example.test/runtime?token=private#fragment"
    const unknownKey = z
      .object({})
      .strict()
      .safeParse({ [url]: "PRIVATE VALUE" })
    if (unknownKey.success) throw new Error("Expected an unknown-key diagnostic.")
    const pathError = new z.ZodError([
      { code: "custom", path: [url], message: `Cannot load ${url}` },
    ])
    for (const error of [unknownKey.error, pathError]) {
      const message = numericalRuntimeMessage("response validation", error)
      expect(message).toContain("https://example.test/runtime")
      for (const sensitive of ["user", "secret", "token", "private", "fragment", "PRIVATE VALUE"])
        expect(message).not.toContain(sensitive)
      expect(message.length).toBeLessThanOrEqual(512)
    }
  })

  it("identifies the failed module load and retains its original fetch cause", () => {
    expect(
      numericalRuntimeMessage(
        "module loading",
        new TypeError(
          "Failed to fetch dynamically imported module: http://127.0.0.1:43115/structural-runtime/pyodide.mjs",
        ),
      ),
    ).toBe(
      "The numerical runtime failed during module loading: Failed to fetch dynamically imported module: http://127.0.0.1:43115/structural-runtime/pyodide.mjs",
    )
  })

  it("distinguishes runtime initialization from package loading failures", () => {
    expect(
      numericalRuntimeMessage("runtime initialization", new WebAssembly.CompileError("Bad WASM")),
    ).toBe("The numerical runtime failed during runtime initialization: Bad WASM")
    expect(
      numericalRuntimeMessage("package loading", new Error("Wheel request returned 404")),
    ).toBe("The numerical runtime failed during package loading: Wheel request returned 404")
  })

  it("keeps schema failure paths and reasons without serializing the rejected response", () => {
    const parsed = z
      .object({ mesh: z.object({ vertices: z.array(z.number()) }) })
      .safeParse({ mesh: { vertices: "PRIVATE INPUT" } })
    if (parsed.success) throw new Error("The response fixture must be malformed.")
    const message = numericalRuntimeMessage("response validation", parsed.error)
    expect(message).toContain("response validation: mesh.vertices:")
    expect(message).toContain("expected array")
    expect(message).not.toContain("PRIVATE INPUT")
    expect(message.length).toBeLessThanOrEqual(512)
  })

  it("reports the final Python exception without traceback frames, source, or exception notes", () => {
    const error = new Error(
      [
        "Traceback (most recent call last):",
        '  File "<exec>", line 1, in <module>',
        "    private_request = {'mesh': 'PRIVATE INPUT'}",
        "ModuleNotFoundError: No module named 'trimesh'",
        "Additional exception note",
      ].join("\n"),
    )
    const message = numericalRuntimeMessage("solver loading", error)
    expect(message).toBe(
      "The numerical runtime failed during solver loading: ModuleNotFoundError: No module named 'trimesh'",
    )
    expect(message).not.toContain("PRIVATE INPUT")
    expect(message).not.toContain("Traceback")
  })

  it("keeps the final exception from a chained Python traceback", () => {
    expect(
      numericalRuntimeMessage(
        "solve",
        new Error(
          "Traceback (most recent call last):\nValueError: First failure\n\nDuring handling of the above exception, another exception occurred:\n\nTraceback (most recent call last):\nRuntimeError: Native analysis failed\n",
        ),
      ),
    ).toBe("The numerical runtime failed during solve: RuntimeError: Native analysis failed")
  })

  it.each(
    [null, undefined, 42, { message: "PRIVATE OBJECT" }, ["PRIVATE ARRAY"], "", " \n "].map(
      (value) => ({ value }),
    ),
  )("does not serialize an unknown or empty failure %j", ({ value }) => {
    expect(numericalRuntimeMessage("response validation", value)).toBe(
      "The numerical runtime failed during response validation: Unknown runtime error.",
    )
  })

  it("uses a thrown string cause and omits subsequent stack-like lines", () => {
    expect(
      numericalRuntimeMessage("geometry generation", "Isosurface failed\n at privateFile:1"),
    ).toBe("The numerical runtime failed during geometry generation: Isosurface failed")
  })

  it("does not release URL credentials, queries, fragments, or embedded data blobs", () => {
    const message = numericalRuntimeMessage(
      "package loading",
      new Error(
        "Fetch https://user:secret@example.com/runtime/pkg.whl?token=private#private failed; data:application/json;base64,PRIVATE blob:http://localhost/PRIVATE",
      ),
    )
    expect(message).toContain("https://example.com/runtime/pkg.whl")
    for (const privateValue of ["user", "secret", "token", "private", "PRIVATE"])
      expect(message).not.toContain(privateValue)
    expect(message).toContain("[runtime URL omitted]")
  })

  it("keeps malformed URL causes reportable instead of throwing a new diagnostic failure", () => {
    expect(
      numericalRuntimeMessage("module loading", new Error("Cannot fetch http://[broken")),
    ).toBe("The numerical runtime failed during module loading: Cannot fetch [invalid runtime URL]")
  })

  it("bounds long causes to the automation diagnostic limit while retaining the stage", () => {
    const message = numericalRuntimeMessage("source preparation", new Error("X".repeat(10_000)))
    expect(message).toStartWith("The numerical runtime failed during source preparation: ")
    expect(message.length).toBe(512)
  })
})
