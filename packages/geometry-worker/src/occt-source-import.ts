import {
  type ImportedSolidSignature,
  type ImportedSourceContent,
  importedSolidSignatureSchema,
  importedSourceContentSchema,
  importedSourceMaterializationSchema,
} from "@vibeshape/protocol"
import type { Shape3D } from "replicad"
import type { OpenCascadeInstance, TopAbs_ShapeEnum, TopoDS_Shape } from "replicad-opencascadejs"
import { castOcctShape } from "./occt-cast"

export type OwnedImportedCandidate = Readonly<{ shape: Shape3D; signature: ImportedSolidSignature }>
export type OwnedImportedOutput = OwnedImportedCandidate &
  Readonly<{ outputId: string; outputRole: string }>
export type InspectedSourceImport = Readonly<{
  candidates: readonly OwnedImportedCandidate[]
  unitEvidence: "explicit-source-metadata"
}>
const MAX_SOLIDS = 128
const MATCH_LINEAR_ABSOLUTE = 1e-6
const MATCH_METRIC_RELATIVE = 1e-7
const MATCH_LINEAR_RELATIVE = 1e-10
let virtualSequence = 0

export class SourceImportError extends Error {
  constructor(
    readonly code: "invalid-source" | "invalid-solid" | "source-mismatch" | "ambiguous-output",
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = "SourceImportError"
  }
}
function invalid(message: string): never {
  throw new SourceImportError("invalid-source", message)
}

/** A native result cannot escape when temporary or virtual-file cleanup fails. */
function transferNativeShape(
  build: (capture: (shape: TopoDS_Shape) => TopoDS_Shape) => TopoDS_Shape,
) {
  let result: TopoDS_Shape | undefined
  try {
    return build((shape) => {
      result = shape
      return shape
    })
  } catch (error) {
    result?.delete()
    throw error
  }
}

async function verifiedBytes(source: ImportedSourceContent, input: unknown) {
  if (!(input instanceof Uint8Array) || input.byteLength !== source.byteLength)
    invalid("Exact source bytes must match the captured byte length.")
  const bytes = Uint8Array.from(input)
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
  if (digest !== source.digest)
    throw new SourceImportError(
      "source-mismatch",
      "Exact source bytes do not match the captured SHA-256 digest.",
    )
  return bytes
}

function readStepModel(
  occt: OpenCascadeInstance,
  path: string,
  capture: (shape: TopoDS_Shape) => TopoDS_Shape,
) {
  const reader = new occt.STEPControl_Reader_1()
  try {
    if (reader.ReadFile(path) !== occt.IFSelect_ReturnStatus.IFSelect_RetDone)
      invalid("OCCT rejected the STEP source file.")
    // The STEP reader converts declared file units once into this millimeter system.
    reader.SetSystemLengthUnit(1)
    if (reader.SystemLengthUnit() !== 1)
      invalid("The STEP reader did not accept the millimeter unit policy.")
    const progress = new occt.Message_ProgressRange_1()
    try {
      if (reader.TransferRoots(progress) < 1)
        invalid("The STEP file contains no transferable exact roots.")
      return capture(reader.OneShape())
    } finally {
      progress.delete()
    }
  } finally {
    try {
      reader.ClearShapes()
    } finally {
      reader.delete()
    }
  }
}
function readStep(occt: OpenCascadeInstance, bytes: Uint8Array): TopoDS_Shape {
  virtualSequence += 1
  const path = `/vibeshape-import-${virtualSequence}.step`
  return transferNativeShape((capture) => {
    let written = false
    let result: TopoDS_Shape | undefined
    const failures: unknown[] = []
    try {
      occt.FS.writeFile(path, bytes)
      written = true
      result = readStepModel(occt, path, capture)
    } catch (error) {
      failures.push(error)
    }
    try {
      occt.FS.unlink(path)
    } catch (error) {
      if (written) failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw new AggregateError(failures, "STEP reading and virtual-file cleanup failed.")
    if (!result) invalid("The STEP reader did not return an exact source shape.")
    return result
  })
}
function readSource(occt: OpenCascadeInstance, source: ImportedSourceContent, bytes: Uint8Array) {
  try {
    if (source.format === "step") return readStep(occt, bytes)
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    const original = occt.BRepToolsWrapper.Read(text)
    if (source.normalization.scaleToMillimeters === 1) return original
    return transferNativeShape((capture) => {
      try {
        return capture(scaleRaw(occt, original, source.normalization.scaleToMillimeters))
      } finally {
        original.delete()
      }
    })
  } catch (error) {
    if (error instanceof SourceImportError) throw error
    throw new SourceImportError(
      "invalid-source",
      "OCCT could not read the exact source bytes.",
      error,
    )
  }
}

function scaleRaw(occt: OpenCascadeInstance, raw: TopoDS_Shape, factor: number): TopoDS_Shape {
  return transferNativeShape((capture) => {
    const origin = new occt.gp_Pnt_3(0, 0, 0)
    try {
      const transform = new occt.gp_Trsf_1()
      try {
        transform.SetScale(origin, factor)
        const builder = new occt.BRepBuilderAPI_Transform_2(raw, transform, true)
        try {
          return capture(builder.Shape())
        } finally {
          builder.delete()
        }
      } finally {
        transform.delete()
      }
    } finally {
      origin.delete()
    }
  })
}

function explore(
  occt: OpenCascadeInstance,
  shape: TopoDS_Shape,
  kind: TopAbs_ShapeEnum,
  visit: (value: TopoDS_Shape) => void,
  avoid = occt.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
) {
  const explorer = new occt.TopExp_Explorer_2(shape, kind, avoid)
  let count = 0
  try {
    while (explorer.More()) {
      count += 1
      const item = explorer.Current()
      try {
        visit(item)
      } finally {
        item.delete()
      }
      explorer.Next()
    }
    return count
  } finally {
    explorer.delete()
  }
}
function requireOnlySolids(occt: OpenCascadeInstance, source: TopoDS_Shape) {
  const types = occt.TopAbs_ShapeEnum
  for (const kind of [
    types.TopAbs_SHELL,
    types.TopAbs_FACE,
    types.TopAbs_WIRE,
    types.TopAbs_EDGE,
    types.TopAbs_VERTEX,
  ])
    explore(
      occt,
      source,
      kind as TopAbs_ShapeEnum,
      () => {
        throw new SourceImportError(
          "invalid-solid",
          "Exact import requires closed solids; loose shells, faces and curves must use a different representation.",
        )
      },
      types.TopAbs_SOLID as TopAbs_ShapeEnum,
    )
}
function bounds(occt: OpenCascadeInstance, shape: Shape3D): ImportedSolidSignature["bounds"] {
  const box = new occt.Bnd_Box_1()
  try {
    occt.BRepBndLib.AddOptimal(shape.wrapped, box, false, true)
    if (box.IsVoid() || box.IsOpen())
      throw new SourceImportError("invalid-solid", "Imported body bounds must be finite.")
    const values = Array.from({ length: 6 }, () => ({ current: Number.NaN }))
    Reflect.apply(box.Get, box, values)
    const coordinate = (index: number) => values[index]?.current ?? Number.NaN
    return {
      min: [coordinate(0), coordinate(1), coordinate(2)],
      max: [coordinate(3), coordinate(4), coordinate(5)],
    }
  } finally {
    box.delete()
  }
}
function signature(occt: OpenCascadeInstance, shape: Shape3D): ImportedSolidSignature {
  const analyzer = new occt.BRepCheck_Analyzer(shape.wrapped, true, false)
  try {
    if (!analyzer.IsValid_2())
      throw new SourceImportError("invalid-solid", "The imported exact body is not a valid B-Rep.")
    const shells = explore(
      occt,
      shape.wrapped,
      occt.TopAbs_ShapeEnum.TopAbs_SHELL as TopAbs_ShapeEnum,
      (shell) => {
        if (!occt.BRep_Tool.IsClosed_1(shell))
          throw new SourceImportError("invalid-solid", "The imported body contains an open shell.")
      },
    )
    if (shells < 1)
      throw new SourceImportError("invalid-solid", "The imported body has no closed shell.")
    const volume = new occt.GProp_GProps_1()
    try {
      const area = new occt.GProp_GProps_1()
      try {
        occt.BRepGProp.VolumeProperties_1(shape.wrapped, volume, true, false, false)
        occt.BRepGProp.SurfaceProperties_1(shape.wrapped, area, false, false)
        const center = volume.CentreOfMass()
        try {
          const parsed = importedSolidSignatureSchema.safeParse({
            volume: volume.Mass(),
            area: area.Mass(),
            centroid: [center.X(), center.Y(), center.Z()],
            bounds: bounds(occt, shape),
            faceCount: explore(
              occt,
              shape.wrapped,
              occt.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
              () => {},
            ),
            // Edge incidences are stable reader-policy metrics, not persistent topological IDs.
            edgeCount: explore(
              occt,
              shape.wrapped,
              occt.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum,
              () => {},
            ),
          })
          if (!parsed.success)
            throw new SourceImportError(
              "invalid-solid",
              "Imported body metrics must be positive, finite and within the 100,000 mm world limit.",
            )
          return parsed.data
        } finally {
          center.delete()
        }
      } finally {
        area.delete()
      }
    } finally {
      volume.delete()
    }
  } finally {
    analyzer.delete()
  }
}

function near(actual: number, expected: number, absolute: number) {
  return (
    Math.abs(actual - expected) <=
    Math.max(absolute, Math.max(Math.abs(actual), Math.abs(expected)) * MATCH_METRIC_RELATIVE)
  )
}
function nearLinear(actual: number, expected: number) {
  return (
    Math.abs(actual - expected) <=
    Math.max(
      MATCH_LINEAR_ABSOLUTE,
      Math.max(Math.abs(actual), Math.abs(expected)) * MATCH_LINEAR_RELATIVE,
    )
  )
}
function sameSignature(actual: ImportedSolidSignature, expected: ImportedSolidSignature) {
  if (actual.faceCount !== expected.faceCount || actual.edgeCount !== expected.edgeCount)
    return false
  if (!near(actual.volume, expected.volume, 1e-9) || !near(actual.area, expected.area, 1e-9))
    return false
  return [actual.centroid, actual.bounds.min, actual.bounds.max].every((vector, index) => {
    const reference = [expected.centroid, expected.bounds.min, expected.bounds.max][index]
    return (
      reference !== undefined &&
      vector.every((value, axis) => nearLinear(value, reference[axis] ?? NaN))
    )
  })
}
function rejectAmbiguous(candidates: readonly OwnedImportedCandidate[]) {
  for (let i = 0; i < candidates.length; i += 1)
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i]
      const right = candidates[j]
      if (left && right && sameSignature(left.signature, right.signature))
        throw new SourceImportError(
          "ambiguous-output",
          "Coincident or indistinguishable imported solids require separated source bodies before import.",
        )
    }
}
function dispose(candidates: readonly OwnedImportedCandidate[]) {
  const failures: unknown[] = []
  for (const shape of new Set(candidates.map((candidate) => candidate.shape))) {
    try {
      shape.delete()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Exact import could not release every owned candidate.")
}

export async function inspectOcctSourceImport(
  occt: OpenCascadeInstance,
  sourceInput: unknown,
  bytesInput: unknown,
): Promise<InspectedSourceImport> {
  const source = importedSourceContentSchema.safeParse(sourceInput)
  if (!source.success) invalid("Exact source metadata or reader policy is invalid.")
  const bytes = await verifiedBytes(source.data, bytesInput)
  const imported = readSource(occt, source.data, bytes)
  const candidates: OwnedImportedCandidate[] = []
  let released = false
  try {
    if (imported.IsNull()) invalid("The exact source reader returned an empty shape.")
    requireOnlySolids(occt, imported)
    explore(occt, imported, occt.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum, (raw) => {
      if (candidates.length >= MAX_SOLIDS)
        invalid("Exact import supports at most 128 solids per source.")
      const shape = castOcctShape(raw)
      try {
        candidates.push({ shape, signature: signature(occt, shape) })
      } catch (error) {
        shape.delete()
        throw error
      }
    })
    if (!candidates.length)
      throw new SourceImportError(
        "invalid-solid",
        "The exact source contains no closed solid bodies.",
      )
    rejectAmbiguous(candidates)
    released = true
    imported.delete()
    return { candidates, unitEvidence: "explicit-source-metadata" }
  } catch (error) {
    dispose(candidates)
    throw error
  } finally {
    if (!released) imported.delete()
  }
}

export async function rebuildOcctSourceImport(
  occt: OpenCascadeInstance,
  input: unknown,
): Promise<readonly OwnedImportedOutput[]> {
  const parsed = importedSourceMaterializationSchema.safeParse(input)
  if (!parsed.success)
    throw new SourceImportError(
      "source-mismatch",
      "Imported feature content, source descriptor and output identities must match.",
    )
  const inspected = await inspectOcctSourceImport(
    occt,
    parsed.data.content.source,
    parsed.data.bytes,
  )
  const matched = new Set<OwnedImportedCandidate>()
  try {
    if (inspected.candidates.length !== parsed.data.content.outputs.length)
      throw new SourceImportError(
        "source-mismatch",
        "The imported solid count no longer matches its captured output manifest.",
      )
    return parsed.data.content.outputs.map(({ outputId, signature: expected }) => {
      const candidates = inspected.candidates.filter((candidate) =>
        sameSignature(candidate.signature, expected),
      )
      const candidate = candidates[0]
      if (!candidate)
        throw new SourceImportError(
          "source-mismatch",
          "A captured imported output no longer matches its exact source; reimport the source.",
        )
      if (candidates.length !== 1 || matched.has(candidate))
        throw new SourceImportError(
          "ambiguous-output",
          "The captured imported output cannot be matched uniquely; reimport an unambiguous source.",
        )
      matched.add(candidate)
      return { ...candidate, outputId, outputRole: `import.${outputId}` }
    })
  } catch (error) {
    dispose(inspected.candidates)
    throw error
  }
}
