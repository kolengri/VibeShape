import { useTranslations } from "@vibeshape/i18n"
import {
  ArrowUpRight,
  Box as BoxIcon,
  Circle,
  CircleDashed,
  CircumscribedPolygonIcon,
  Construction,
  CopyPlus,
  Cuboid,
  DraftingCompass,
  EllipseIcon,
  EllipticalArcIcon,
  FinalResultIcon,
  FlipHorizontal2,
  Grid2X2,
  InscribedPolygonIcon,
  Layers3,
  Minus,
  MousePointer2,
  Move,
  PenLine,
  RectangleHorizontal,
  Redo2,
  RotateCw,
  Ruler,
  Scan,
  Scissors,
  Slash,
  Spline,
  Split,
  Undo2,
  X,
} from "@vibeshape/ui/components/icons"
import type { ComponentType, SVGProps } from "react"
import type {
  EditorCommandDescriptor,
  EditorCommandDisabledReason,
  EditorCommandGroup,
  EditorCommandIcon,
  EditorCommandLabelKey,
  EditorCommandShortcut,
} from "./editor-command"

const icons: Readonly<Record<EditorCommandIcon, ComponentType<SVGProps<SVGSVGElement>>>> = {
  "aligned-rectangle": RectangleHorizontal,
  arc: PenLine,
  box: BoxIcon,
  cancel: X,
  circle: Circle,
  ellipse: EllipseIcon,
  "elliptical-arc": EllipticalArcIcon,
  "circular-pattern": RotateCw,
  "circumscribed-polygon": CircumscribedPolygonIcon,
  "center-rectangle": Scan,
  "centered-aligned-rectangle": Scan,
  "centered-slot": Scan,
  construction: Construction,
  cylinder: Circle,
  "datum-plane": Layers3,
  dimension: Ruler,
  extrude: BoxIcon,
  revolve: RotateCw,
  extend: ArrowUpRight,
  line: Slash,
  "linear-pattern": Grid2X2,
  mirror: FlipHorizontal2,
  offset: CopyPlus,
  "orbit-view": RotateCw,
  "final-context": FinalResultIcon,
  "inscribed-polygon": InscribedPolygonIcon,
  "midpoint-line": Minus,
  model: Cuboid,
  "normal-view": Scan,
  point: Circle,
  rectangle: RectangleHorizontal,
  redo: Redo2,
  select: MousePointer2,
  sketch: DraftingCompass,
  slot: Minus,
  split: Split,
  transform: Move,
  subtract: Scissors,
  "tangent-arc": PenLine,
  trim: Scissors,
  "three-point-arc": Spline,
  "three-point-circle": CircleDashed,
  undo: Undo2,
}

export function EditorCommandIconView({ icon }: { icon: EditorCommandIcon }) {
  const Icon = icons[icon]
  return <Icon aria-hidden="true" />
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
}

export function editorCommandShortcutLabel(shortcut: EditorCommandShortcut) {
  const modifiers = new Set(shortcut.modifiers ?? [])
  const parts: string[] = []
  if (modifiers.has("mod")) parts.push(isMacPlatform() ? "⌘" : "Ctrl")
  if (modifiers.has("alt")) parts.push(isMacPlatform() ? "⌥" : "Alt")
  if (modifiers.has("shift")) parts.push(isMacPlatform() ? "⇧" : "Shift")
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key
  parts.push(key)
  return parts.join(isMacPlatform() ? "" : "+")
}

export function useEditorCommandCopy() {
  const t = useTranslations("app.commands")
  return {
    disabledReason: (reason: EditorCommandDisabledReason) => t(`disabledReasons.${reason}`),
    group: (group: EditorCommandGroup) => t(`groups.${group}`),
    keywords: (key: EditorCommandLabelKey) => t(`items.${key}.keywords`).split("|"),
    label: (descriptor: EditorCommandDescriptor) => t(`items.${descriptor.labelKey}.label`),
  }
}
