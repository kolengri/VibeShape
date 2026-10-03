import type { Shape3D } from "replicad"
import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { createOcctCompound } from "./occt-compound"
import { placeOcctShape } from "./occt-placement"
import { fuseOcctShapes } from "./occt-shapes"
import type { ShapeRegistryOutput } from "./shape-registry"

export type OwnedBodyCombination = Readonly<{
  shape: Shape3D
  outputs: readonly ShapeRegistryOutput<Shape3D>[]
}>
type NativeOperations = Readonly<{
  compound: typeof createOcctCompound
  fuse: typeof fuseOcctShapes
  copy: (opencascade: OpenCascadeInstance, source: Shape3D) => Shape3D
}>

function copyBody(opencascade: OpenCascadeInstance, source: Shape3D) {
  return placeOcctShape(opencascade, source, { translation: [0, 0, 0], rotation: [0, 0, 0] })
}

function validateSelection(sources: readonly Shape3D[]) {
  if (sources.length < 2 || sources.length > 8)
    throw new RangeError("Select two to eight exact body inputs.")
}

/** A bundle is either transferred to the native registry or disposed completely by its caller. */
export function disposeBodyCombination(bundle: OwnedBodyCombination | null): boolean {
  if (!bundle) return true
  let released = true
  const shapes = new Set([bundle.shape, ...bundle.outputs.map(({ shape }) => shape)])
  for (const shape of [...shapes].reverse()) {
    try {
      shape.delete()
    } catch {
      released = false
    }
  }
  return released
}

export function createOcctBodyCombinationOperations(
  operations: NativeOperations = {
    compound: createOcctCompound,
    fuse: fuseOcctShapes,
    copy: copyBody,
  },
) {
  return {
    compoundBodies(
      opencascade: OpenCascadeInstance,
      sources: readonly Shape3D[],
      outputRoles: readonly string[],
    ): OwnedBodyCombination {
      validateSelection(sources)
      if (outputRoles.length !== sources.length || new Set(outputRoles).size !== sources.length)
        throw new Error("Each selected body requires one unique authored compound output role.")
      const outputs: ShapeRegistryOutput<Shape3D>[] = []
      try {
        for (const [index, source] of sources.entries()) {
          const role = outputRoles[index]
          if (!role) throw new Error("Compound output role is unavailable.")
          outputs.push({ role, shape: operations.copy(opencascade, source) })
        }
        return {
          shape: operations.compound(
            opencascade,
            outputs.map(({ shape }) => shape),
          ),
          outputs,
        }
      } catch (error) {
        for (const { shape } of outputs.reverse()) {
          try {
            shape.delete()
          } catch {
            /* Preserve the original failure while releasing every acquired copy. */
          }
        }
        throw error
      }
    },
    unionBodies(opencascade: OpenCascadeInstance, sources: readonly Shape3D[]): Shape3D {
      validateSelection(sources)
      const [first, ...rest] = sources
      if (!first) throw new Error("Union target is unavailable.")
      let result: Shape3D | null = operations.copy(opencascade, first)
      try {
        for (const tool of rest) {
          const previous = result
          if (!previous) throw new Error("Union intermediate result is unavailable.")
          result = null
          let copiedTool: Shape3D | null = null
          try {
            copiedTool = operations.copy(opencascade, tool)
            result = operations.fuse(opencascade, previous, copiedTool)
          } finally {
            try {
              previous.delete()
            } finally {
              copiedTool?.delete()
            }
          }
        }
        if (!result) throw new Error("Union result is unavailable.")
        return result
      } catch (error) {
        if (result) {
          try {
            result.delete()
          } catch {
            /* Preserve the original failure. */
          }
        }
        throw error
      }
    },
  }
}

export const { compoundBodies: createOcctBodyCompound, unionBodies: createOcctBodyUnion } =
  createOcctBodyCombinationOperations()
