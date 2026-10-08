import { describe, expect, it } from "bun:test"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { createOcctExchangeOperations } from "./occt-exchange"

function createDeletable() {
  return { delete: vi.fn() }
}

function createConstructor<T>(value: T) {
  return vi.fn(function MockConstructor() {
    return value
  })
}

describe("owned OCCT STEP exchange adapter", () => {
  it("resets the writer model and deletes all export temporaries", () => {
    const done = {}
    const initialModel = createDeletable()
    const resetModel = createDeletable()
    const progress = createDeletable()
    const writer = {
      ...createDeletable(),
      Model: vi.fn().mockReturnValueOnce(initialModel).mockReturnValueOnce(resetModel),
      Transfer: vi.fn(() => done),
      Write: vi.fn(() => done),
    }
    const unlink = vi.fn()
    const opencascade = {
      FS: { readFile: vi.fn(() => Uint8Array.from([1, 2, 3])), unlink },
      IFSelect_ReturnStatus: { IFSelect_RetDone: done },
      Interface_Static: { SetIVal: vi.fn() },
      Message_ProgressRange_1: createConstructor(progress),
      STEPControl_StepModelType: { STEPControl_AsIs: {} },
      STEPControl_Writer_1: createConstructor(writer),
    } as unknown as OpenCascadeInstance
    const shape = createDeletable()
    const operations = createOcctExchangeOperations(vi.fn() as never)

    const bytes = operations.exportStep(opencascade, shape as never)

    expect(bytes).toEqual(Uint8Array.from([1, 2, 3]))
    expect(initialModel.delete).toHaveBeenCalledTimes(1)
    expect(resetModel.delete).toHaveBeenCalledTimes(1)
    expect(progress.delete).toHaveBeenCalledTimes(1)
    expect(writer.delete).toHaveBeenCalledTimes(1)
    expect(unlink).toHaveBeenCalledTimes(1)
  })

  it("clears reader-owned shapes after adopting the imported root", () => {
    const done = {}
    const rawShape = createDeletable()
    const adoptedShape = { wrapped: createDeletable() }
    const progress = createDeletable()
    const reader = {
      ...createDeletable(),
      ClearShapes: vi.fn(),
      OneShape: vi.fn(() => rawShape),
      ReadFile: vi.fn(() => done),
      TransferRoots: vi.fn(() => 1),
    }
    const unlink = vi.fn()
    const writeFile = vi.fn()
    const castShape = vi.fn(() => adoptedShape)
    const opencascade = {
      FS: { unlink, writeFile },
      IFSelect_ReturnStatus: { IFSelect_RetDone: done },
      Message_ProgressRange_1: createConstructor(progress),
      STEPControl_Reader_1: createConstructor(reader),
    } as unknown as OpenCascadeInstance
    const operations = createOcctExchangeOperations(castShape as never)
    const bytes = Uint8Array.from([4, 5, 6])

    const result = operations.importStep(opencascade, bytes)

    expect(result).toBe<unknown>(adoptedShape)
    expect(writeFile).toHaveBeenCalledWith(expect.stringMatching(/^\/vibeshape-\d+\.step$/), bytes)
    expect(castShape).toHaveBeenCalledWith(rawShape)
    expect(rawShape.delete).toHaveBeenCalledTimes(1)
    expect(progress.delete).toHaveBeenCalledTimes(1)
    expect(reader.ClearShapes).toHaveBeenCalledTimes(1)
    expect(reader.delete).toHaveBeenCalledTimes(1)
    expect(unlink).toHaveBeenCalledTimes(1)
  })
})
