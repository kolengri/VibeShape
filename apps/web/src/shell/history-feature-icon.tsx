import type { FeatureRecord } from "@vibeshape/domain"
import type { EditorCommandIcon } from "../commands/editor-command"
import { EditorCommandIconView } from "../commands/editor-command-presentation"

const featureIcons: Readonly<Record<string, EditorCommandIcon>> = {
  "org.vibeshape.feature.part-design.box": "box",
  "org.vibeshape.feature.part-design.cylinder": "cylinder",
  "org.vibeshape.feature.part-design.sphere": "sphere",
  "org.vibeshape.feature.part-design.cone": "cone",
  "org.vibeshape.feature.part-design.pyramid": "pyramid",
  "org.vibeshape.feature.part-design.torus": "torus",
  "org.vibeshape.feature.part-design.extrusion": "extrude",
  "org.vibeshape.feature.part-design.revolve": "revolve",
  "org.vibeshape.feature.part-design.loft": "loft",
  "org.vibeshape.feature.part-design.sweep": "sweep",
  "org.vibeshape.feature.part-design.hole": "hole",
  "org.vibeshape.feature.part-design.fillet": "fillet",
  "org.vibeshape.feature.part-design.chamfer": "chamfer",
  "org.vibeshape.feature.part-design.boolean": "subtract",
  "org.vibeshape.feature.part-design.compound": "compound",
  "org.vibeshape.feature.part-design.union": "union",
  "org.vibeshape.feature.part-design.placement": "transform",
  "org.vibeshape.feature.part-design.mirror": "mirror",
  "org.vibeshape.feature.part-design.pattern": "linear-pattern",
  "org.vibeshape.feature.part-design.shell": "shell",
  "org.vibeshape.feature.part-design.thread": "thread",
  "org.vibeshape.feature.part-design.fdm": "shell",
}

export function HistoryFeatureIcon({ feature }: { feature: FeatureRecord }) {
  return <EditorCommandIconView icon={featureIcons[feature.type.typeId] ?? "model"} />
}
