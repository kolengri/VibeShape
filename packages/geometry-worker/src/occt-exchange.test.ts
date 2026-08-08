import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { describe, expect, it, vi } from "vitest"
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
    expect(initialModel.delete).toHaveBeenCalledOnce()
    expect(resetModel.delete).toHaveBeenCalledOnce()
    expect(progress.delete).toHaveBeenCalledOnce()
    expect(writer.delete).toHaveBeenCalledOnce()
    expect(unlink).toHaveBeenCalledOnce()
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

    expect(result).toBe(adoptedShape)
    expect(writeFile).toHaveBeenCalledWith(expect.stringMatching(/^\/vibeshape-\d+\.step$/), bytes)
    expect(castShape).toHaveBeenCalledWith(rawShape)
    expect(rawShape.delete).toHaveBeenCalledOnce()
    expect(progress.delete).toHaveBeenCalledOnce()
    expect(reader.ClearShapes).toHaveBeenCalledOnce()
    expect(reader.delete).toHaveBeenCalledOnce()
    expect(unlink).toHaveBeenCalledOnce()
  })
})
