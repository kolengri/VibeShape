import { layPrintFacetOnBed } from "@vibeshape/print-analysis"
import type { PrintPreparationResult } from "@vibeshape/protocol"

type OrientationField = "rotationX" | "rotationY" | "rotationZ"
type OrientationForm = {
  state: { values: Record<OrientationField, string> }
  setFieldValue: (name: OrientationField, value: string) => unknown
  handleSubmit: () => Promise<void>
}

export async function placePreparedPrintFace(
  result: PrintPreparationResult | undefined,
  form: OrientationForm,
  meshIndex: number,
  triangleIndex: number,
) {
  const mesh = result?.meshes[meshIndex]
  if (!mesh || meshIndex >= (result?.report.bodyCount ?? 0)) {
    throw new Error("A print orientation requires a selected model facet.")
  }
  const values = form.state.values
  const angles = layPrintFacetOnBed(mesh, triangleIndex, {
    rotationX: Number(values.rotationX),
    rotationY: Number(values.rotationY),
    rotationZ: Number(values.rotationZ),
  })
  for (const field of ["rotationX", "rotationY", "rotationZ"] as const) {
    form.setFieldValue(field, String(angles[field]))
  }
  await form.handleSubmit()
}
