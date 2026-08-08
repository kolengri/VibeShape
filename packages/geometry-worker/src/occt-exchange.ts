import type { OpenCascadeInstance } from "replicad-opencascadejs"
import { adoptOcctShape, castOcctShape, type OcctShapeCaster } from "./occt-cast"

let virtualFileSequence = 0

function createVirtualFilePath(extension: string) {
  virtualFileSequence += 1
  return `/vibeshape-${virtualFileSequence}.${extension}`
}

function unlinkVirtualFile(opencascade: OpenCascadeInstance, path: string) {
  try {
    opencascade.FS.unlink(path)
  } catch {
    // The exchange tool can fail before creating the virtual file.
  }
}

function copyVirtualFile(opencascade: OpenCascadeInstance, path: string) {
  const source = opencascade.FS.readFile(path)
  const bytes = new Uint8Array(source.byteLength)
  bytes.set(source)
  return bytes
}

export function createOcctExchangeOperations(castShape: OcctShapeCaster) {
  function exportStep(opencascade: OpenCascadeInstance, shape: Parameters<OcctShapeCaster>[0]) {
    const filename = createVirtualFilePath("step")

    try {
      const writer = new opencascade.STEPControl_Writer_1()

      try {
        opencascade.Interface_Static.SetIVal("write.step.schema", 5)
        writer.Model(true).delete()
        const progress = new opencascade.Message_ProgressRange_1()

        try {
          const transferStatus = writer.Transfer(
            shape,
            opencascade.STEPControl_StepModelType.STEPControl_AsIs as never,
            true,
            progress,
          )

          if (transferStatus !== opencascade.IFSelect_ReturnStatus.IFSelect_RetDone) {
            throw new Error("OCCT failed to transfer the shape into the STEP model.")
          }

          if (writer.Write(filename) !== opencascade.IFSelect_ReturnStatus.IFSelect_RetDone) {
            throw new Error("OCCT failed to write the STEP file.")
          }

          return copyVirtualFile(opencascade, filename)
        } finally {
          progress.delete()
        }
      } finally {
        try {
          writer.Model(true).delete()
        } finally {
          writer.delete()
        }
      }
    } finally {
      unlinkVirtualFile(opencascade, filename)
    }
  }

  function importStep(opencascade: OpenCascadeInstance, bytes: Uint8Array) {
    const filename = createVirtualFilePath("step")
    opencascade.FS.writeFile(filename, bytes)

    try {
      const reader = new opencascade.STEPControl_Reader_1()

      try {
        if (reader.ReadFile(filename) !== opencascade.IFSelect_ReturnStatus.IFSelect_RetDone) {
          throw new Error("OCCT failed to read the STEP file.")
        }

        const progress = new opencascade.Message_ProgressRange_1()

        try {
          if (reader.TransferRoots(progress) < 1) {
            throw new Error("OCCT did not transfer any STEP root shapes.")
          }

          return adoptOcctShape(reader.OneShape(), castShape)
        } finally {
          progress.delete()
        }
      } finally {
        reader.ClearShapes()
        reader.delete()
      }
    } finally {
      unlinkVirtualFile(opencascade, filename)
    }
  }

  return { exportStep, importStep }
}

export const { exportStep: exportOcctStep, importStep: importOcctStep } =
  createOcctExchangeOperations(castOcctShape)
