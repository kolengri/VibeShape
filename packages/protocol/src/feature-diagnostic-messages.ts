/**
 * Feature types whose kernel failure message names the failing input precisely enough to show
 * verbatim. The document worker forwards these messages and the editor displays them, so both
 * sides read this one list.
 */
export function featureForwardsDiagnosticMessage(
  type: Readonly<{ typeId: string; schemaVersion: number }>,
) {
  switch (type.typeId) {
    case "org.vibeshape.feature.part-design.loft":
      return type.schemaVersion === 3
    case "org.vibeshape.feature.part-design.press-pull":
      return type.schemaVersion === 2
    case "org.vibeshape.feature.part-design.fillet":
    case "org.vibeshape.feature.part-design.draft":
    case "org.vibeshape.feature.part-design.thicken":
      return true
    default:
      return false
  }
}
