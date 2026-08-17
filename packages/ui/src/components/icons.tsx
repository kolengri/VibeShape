export {
  ArrowUpRight,
  Box,
  ChevronDown,
  Circle,
  CircleDashed,
  Command as CommandIcon,
  Construction,
  CopyPlus,
  Cuboid,
  Download,
  DraftingCompass,
  FlipHorizontal2,
  FolderOpen,
  Grid2X2,
  Minus,
  MousePointer2,
  Move,
  Pencil,
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
  Trash2,
  Undo2,
  X,
} from "lucide-react"

import type { SVGProps } from "react"

export function InscribedPolygonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 2.5 20.2 7.25v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Z" />
    </svg>
  )
}

export function CircumscribedPolygonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 4.5 18.5 8.25v7.5L12 19.5l-6.5-3.75v-7.5L12 4.5Z" />
    </svg>
  )
}

export function EllipseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-25 12 12)" />
      <path d="M4.1 15.8 19.9 8.2M12 12l2.1 4.3" strokeDasharray="1.5 2" />
    </svg>
  )
}
