import { makeBox, measureVolume, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as casting from "./occt-cast"
import { draftExtrusionTool } from "./occt-extrusion-end"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const { readFileSync } = await vi.importActual<{ readFileSync(path: URL): Uint8Array }>("node:fs")
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    {
      wasmBinary: new Uint8Array(
        readFileSync(
          new URL(
            "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
            import.meta.url,
          ),
        ),
      ),
    },
  ])
  setOC(occt)
})

describe("draft inspection exception ownership", () => {
  it.each(["analyzer", "volume"] as const)(
    "releases the drafted solid after a native %s exception",
    (phase) => {
      const source = makeBox([0, 0, 0], [4, 4, 10])
      const volume = measureVolume(source)
      const sourceDelete = vi.spyOn(source, "delete")
      const adoptedDeletes: ReturnType<typeof vi.spyOn>[] = []
      const adopt = casting.adoptOcctShape
      const castSpy = vi.spyOn(casting, "adoptOcctShape").mockImplementation((shape, cast) => {
        const result = adopt(shape, cast)
        adoptedDeletes.push(vi.spyOn(result, "delete"))
        return result
      })
      const failure = new Error(`Injected ${phase} inspection failure`)
      const failingOcct =
        phase === "analyzer"
          ? new Proxy(occt, {
              get(target, key) {
                if (key === "BRepCheck_Analyzer")
                  return class {
                    constructor() {
                      throw failure
                    }
                  }
                return Reflect.get(target, key)
              },
            })
          : occt
      const volumeSpy =
        phase === "volume"
          ? vi.spyOn(occt.BRepGProp, "VolumeProperties_1").mockImplementationOnce(() => {
              throw failure
            })
          : null
      try {
        expect(() =>
          draftExtrusionTool(failingOcct, source, [0, 0, 0], [0, 0, 1], Math.PI / 36),
        ).toThrow(failure)
        expect(adoptedDeletes).toHaveLength(1)
        expect(adoptedDeletes[0]).toHaveBeenCalledOnce()
        expect(sourceDelete).not.toHaveBeenCalled()
        volumeSpy?.mockRestore()
        expect(measureVolume(source)).toBeCloseTo(volume, 8)
      } finally {
        volumeSpy?.mockRestore()
        castSpy.mockRestore()
        source.delete()
      }
    },
  )
})
