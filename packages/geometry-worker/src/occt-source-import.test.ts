import { beforeAll, describe, expect, it } from "bun:test"
import { makeBox, measureVolume, type Shape3D, Solid, setOC } from "replicad"
import initializeOpenCascade, {
  type OpenCascadeInstance,
  type STEPControl_Reader,
  type TopoDS_Shape,
} from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { createOcctCompound } from "./occt-compound"
import { exportOcctStep } from "./occt-exchange"
import {
  inspectOcctSourceImport,
  rebuildOcctSourceImport,
  SourceImportError,
} from "./occt-source-import"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
let occt: OpenCascadeInstance
beforeAll(async () => {
  const path = new URL(
    "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
    import.meta.url,
  )
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    { locateFile: () => path.pathname },
  ])
  setOC(occt)
}, 60_000)
async function source(
  bytes: Uint8Array,
  format: "step" | "brep",
  scale = 1,
  unit: "millimeter" | "centimeter" | "inch" = scale === 10 ? "centimeter" : "millimeter",
) {
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
  return {
    digest,
    byteLength: bytes.byteLength,
    format,
    normalization: { sourceUnit: unit, scaleToMillimeters: scale, normalizedUnit: "millimeter" },
    unitPolicy: format === "step" ? "step-system-mm" : "brep-source-normalized",
    readerPolicyVersion: 1,
  }
}
function brep(shape: { wrapped: TopoDS_Shape }) {
  return new TextEncoder().encode(occt.BRepToolsWrapper.Write(shape.wrapped))
}
function release(shapes: readonly { shape: Shape3D }[]) {
  for (const { shape } of shapes) shape.delete()
}
function firstShape(shapes: readonly { shape: Shape3D }[]) {
  const first = shapes[0]
  if (!first) throw new Error("The fixture requires one imported solid.")
  return first.shape
}
async function manifest(bytes: Uint8Array, format: "step" | "brep", scale = 1) {
  const metadata = await source(bytes, format, scale)
  const prepared = await inspectOcctSourceImport(occt, metadata, bytes)
  try {
    const outputs = prepared.candidates.map(({ signature }, index) => ({
      outputId: id(100 + index),
      signature,
    }))
    const asset = {
      id: id(50),
      digest: metadata.digest,
      byteLength: bytes.byteLength,
      filename: `Source.${format}`,
      format,
      representation: "exact-solid",
      normalization: metadata.normalization,
      outputs: outputs.map(({ outputId }) => outputId),
    }
    return {
      sourceAssetId: asset.id,
      asset,
      content: { source: metadata, outputs, matchingPolicyVersion: 1 },
      bytes,
    }
  } finally {
    release(prepared.candidates)
  }
}

describe("verified exact source import with the pinned OCCT kernel", () => {
  it("imports STEP and BREP closed solids and applies BREP normalization exactly once", async () => {
    const shape = makeBox([0, 0, 0], [2, 3, 4])
    try {
      const stepBytes = exportOcctStep(occt, shape.wrapped)
      expect(new TextDecoder().decode(stepBytes)).toContain("SI_UNIT(.MILLI.,.METRE.)")
      const step = await rebuildOcctSourceImport(occt, await manifest(stepBytes, "step"))
      try {
        expect(measureVolume(firstShape(step))).toBeCloseTo(24, 7)
        expect(step[0]?.outputRole).toBe(`import.${id(100)}`)
      } finally {
        release(step)
      }
      const brepBytes = brep(shape)
      const normalized = await rebuildOcctSourceImport(occt, await manifest(brepBytes, "brep", 10))
      try {
        expect(measureVolume(firstShape(normalized))).toBeCloseTo(24_000, 5)
        expect(normalized[0]?.signature.bounds.max[2]).toBeCloseTo(40, 5)
      } finally {
        release(normalized)
      }
    } finally {
      shape.delete()
    }
  })

  it("converts declared inch STEP units through the reader without double-applying source provenance", async () => {
    const shape = makeBox([0, 0, 0], [25.4, 50.8, 76.2])
    let bytes: Uint8Array
    try {
      occt.Interface_Static.SetCVal("write.step.unit", "INCH")
      bytes = exportOcctStep(occt, shape.wrapped)
    } finally {
      occt.Interface_Static.SetCVal("write.step.unit", "MM")
      shape.delete()
    }
    expect(new TextDecoder().decode(bytes)).toMatch(/CONVERSION_BASED_UNIT\('INCH'/)
    const parsed = await inspectOcctSourceImport(
      occt,
      await source(bytes, "step", 25.4, "inch"),
      bytes,
    )
    try {
      expect(parsed.unitEvidence).toBe("explicit-source-metadata")
      expect(parsed.candidates[0]?.signature.bounds.max[0]).toBeCloseTo(25.4, 4)
      expect(parsed.candidates[0]?.signature.volume).toBeCloseTo(25.4 * 50.8 * 76.2, 3)
    } finally {
      release(parsed.candidates)
    }
  })

  it("binds multiple UUID outputs by captured invariants when manifest order changes", async () => {
    const first = makeBox([0, 0, 0], [2, 3, 4])
    const second = makeBox([10, 20, 30], [15, 26, 37])
    const combined = createOcctCompound(occt, [first, second])
    try {
      const bytes = brep(combined)
      const input = await manifest(bytes, "brep")
      const expected = input.content.outputs.map(({ signature }) => signature.volume).reverse()
      input.content.outputs.reverse()
      input.asset.outputs.reverse()
      const outputs = await rebuildOcctSourceImport(occt, input)
      try {
        expect(outputs.map(({ shape }) => measureVolume(shape))).toEqual(
          expect.arrayContaining(expected),
        )
        expect(outputs.map(({ outputId }) => outputId)).toEqual(input.asset.outputs)
        expect(outputs[0]?.signature.volume).toBeCloseTo(expected[0] ?? 0, 6)
      } finally {
        release(outputs)
      }
    } finally {
      combined.delete()
      first.delete()
      second.delete()
    }
  })

  it("rejects digest/descriptor mismatch, unsupported representation, malformed and ambiguous exact sources", async () => {
    const shape = makeBox([0, 0, 0], [2, 3, 4])
    const same = makeBox([0, 0, 0], [2, 3, 4])
    const ambiguous = createOcctCompound(occt, [shape, same])
    try {
      const bytes = brep(shape)
      const input = await manifest(bytes, "brep")
      await expect(
        rebuildOcctSourceImport(occt, { ...input, bytes: new Uint8Array(bytes.length) }),
      ).rejects.toMatchObject({ code: "source-mismatch" })
      await expect(
        rebuildOcctSourceImport(occt, {
          ...input,
          asset: { ...input.asset, representation: "triangle-mesh" },
        }),
      ).rejects.toBeInstanceOf(SourceImportError)
      await expect(
        rebuildOcctSourceImport(occt, {
          ...input,
          content: {
            ...input.content,
            outputs: [{ ...input.content.outputs[0], outputId: id(999) }],
          },
        }),
      ).rejects.toMatchObject({ code: "source-mismatch" })
      const malformed = new TextEncoder().encode("Not a BREP source")
      await expect(
        inspectOcctSourceImport(occt, await source(malformed, "brep"), malformed),
      ).rejects.toMatchObject({ code: "invalid-source" })
      const duplicate = brep(ambiguous)
      await expect(
        inspectOcctSourceImport(occt, await source(duplicate, "brep"), duplicate),
      ).rejects.toMatchObject({ code: "ambiguous-output" })
      const outside = makeBox([100_001, 0, 0], [100_002, 1, 1])
      try {
        const outBytes = brep(outside)
        await expect(
          inspectOcctSourceImport(occt, await source(outBytes, "brep"), outBytes),
        ).rejects.toMatchObject({ code: "invalid-solid" })
      } finally {
        outside.delete()
      }
    } finally {
      ambiguous.delete()
      shape.delete()
      same.delete()
    }
  })

  it("rejects loose faces and open solids instead of upgrading them into exact bodies", async () => {
    const box = makeBox([0, 0, 0], [2, 3, 4])
    const faces = box.faces
    const shell = new occt.TopoDS_Shell()
    const builder = new occt.TopoDS_Builder()
    try {
      const face = faces[0]
      if (!face) throw new Error("The box fixture requires a face.")
      const faceBytes = brep(face)
      await expect(
        inspectOcctSourceImport(occt, await source(faceBytes, "brep"), faceBytes),
      ).rejects.toMatchObject({ code: "invalid-solid" })
      builder.MakeShell(shell)
      for (const face of faces.slice(1)) builder.Add(shell, face.wrapped)
      const makeSolid = new occt.BRepBuilderAPI_MakeSolid_3(shell)
      try {
        const raw = makeSolid.Shape()
        try {
          const bytes = brep({ wrapped: raw })
          await expect(
            inspectOcctSourceImport(occt, await source(bytes, "brep"), bytes),
          ).rejects.toMatchObject({ code: "invalid-solid" })
        } finally {
          raw.delete()
        }
      } finally {
        makeSolid.delete()
      }
    } finally {
      builder.delete()
      shell.delete()
      for (const face of faces) face.delete()
      box.delete()
    }
  })

  it("releases each owned candidate once on repeated matching failure and preserves later successful reads", async () => {
    const first = makeBox([0, 0, 0], [2, 3, 4])
    const second = makeBox([10, 20, 30], [15, 26, 37])
    const combined = createOcctCompound(occt, [first, second])
    try {
      const bytes = brep(combined)
      const input = await manifest(bytes, "brep")
      const outputs = input.content.outputs.map((output) => ({
        ...output,
        signature: { ...output.signature, volume: output.signature.volume * 2 },
      }))
      const cleanup = vi.spyOn(Solid.prototype, "delete")
      try {
        for (let index = 0; index < 3; index += 1)
          await expect(
            rebuildOcctSourceImport(occt, { ...input, content: { ...input.content, outputs } }),
          ).rejects.toMatchObject({ code: "source-mismatch" })
        expect(cleanup).toHaveBeenCalledTimes(6)
        expect(new Set(cleanup.mock.contexts).size).toBe(6)
      } finally {
        cleanup.mockRestore()
      }
      const rebuilt = await rebuildOcctSourceImport(occt, input)
      try {
        expect(rebuilt).toHaveLength(2)
      } finally {
        release(rebuilt)
      }
    } finally {
      combined.delete()
      first.delete()
      second.delete()
    }
  })

  it("enforces the solid budget and removes failed STEP virtual files", async () => {
    const solids = Array.from({ length: 129 }, (_, index) =>
      makeBox([index * 2, 0, 0], [index * 2 + 1, 1, 1]),
    )
    const combined = createOcctCompound(occt, solids)
    try {
      const bytes = brep(combined)
      await expect(
        inspectOcctSourceImport(occt, await source(bytes, "brep"), bytes),
      ).rejects.toMatchObject({ code: "invalid-source" })
    } finally {
      combined.delete()
      for (const solid of solids) solid.delete()
    }
    const before = occt.FS.readdir("/")
    const bytes = new TextEncoder().encode("Not a STEP source")
    await expect(
      inspectOcctSourceImport(occt, await source(bytes, "step"), bytes),
    ).rejects.toMatchObject({ code: "invalid-source" })
    expect(occt.FS.readdir("/")).toEqual(before)
  })

  it("withholds and releases a STEP result when virtual-file cleanup fails", async () => {
    const box = makeBox([0, 0, 0], [2, 3, 4])
    let bytes: Uint8Array
    try {
      bytes = exportOcctStep(occt, box.wrapped)
    } finally {
      box.delete()
    }
    const read = occt.STEPControl_Reader.prototype.OneShape
    const unlink = occt.FS.unlink.bind(occt.FS)
    let released = 0
    const capture = vi
      .spyOn(occt.STEPControl_Reader.prototype, "OneShape")
      .mockImplementation(function (this: STEPControl_Reader) {
        const result = read.call(this)
        const dispose = result.delete.bind(result)
        result.delete = () => {
          released += 1
          dispose()
        }
        return result
      })
    const cleanup = vi.spyOn(occt.FS, "unlink").mockImplementation((path: string) => {
      unlink(path)
      throw new Error("Injected virtual-file cleanup failure.")
    })
    try {
      await expect(
        inspectOcctSourceImport(occt, await source(bytes, "step"), bytes),
      ).rejects.toMatchObject({ code: "invalid-source" })
      expect(released).toBe(1)
    } finally {
      cleanup.mockRestore()
      capture.mockRestore()
    }
  })

  it("continues releasing sibling candidates after one destructor fails", async () => {
    const first = makeBox([0, 0, 0], [2, 3, 4])
    const second = makeBox([10, 20, 30], [15, 26, 37])
    const combined = createOcctCompound(occt, [first, second])
    try {
      const input = await manifest(brep(combined), "brep")
      const outputs = input.content.outputs.map((output) => ({
        ...output,
        signature: { ...output.signature, volume: output.signature.volume * 2 },
      }))
      const dispose = Solid.prototype.delete
      const cleanup = vi.spyOn(Solid.prototype, "delete").mockImplementationOnce(function (
        this: Solid,
      ) {
        dispose.call(this)
        throw new Error("Injected candidate cleanup failure.")
      })
      try {
        await expect(
          rebuildOcctSourceImport(occt, { ...input, content: { ...input.content, outputs } }),
        ).rejects.toBeInstanceOf(AggregateError)
        expect(cleanup).toHaveBeenCalledTimes(2)
        expect(new Set(cleanup.mock.contexts).size).toBe(2)
      } finally {
        cleanup.mockRestore()
      }
    } finally {
      combined.delete()
      first.delete()
      second.delete()
    }
  })
})
