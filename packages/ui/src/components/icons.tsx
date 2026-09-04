export {
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleDashed,
  Command as CommandIcon,
  Construction,
  CopyPlus,
  Cuboid,
  Download,
  DraftingCompass,
  Ellipsis,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FolderOpen,
  Grid2X2,
  Layers3,
  Link2,
  Minus,
  MousePointer2,
  Move,
  PanelBottomClose,
  PanelBottomOpen,
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

export function EllipticalArcIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M3.6 13.7c1.4 4.1 6.8 6.1 12 4.4s8.2-6.4 6.8-10.5" />
      <path d="m3.6 13.7 18.8-6.1M13 10.7l2.1 4.2" strokeDasharray="1.5 2" />
      <circle cx="3.6" cy="13.7" r="1" fill="currentColor" stroke="none" />
      <circle cx="22.4" cy="7.6" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function FinalResultIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M4 6h9M4 12h9M4 18h9M18 4v16M13 12h5" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IntersectionIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="m3 7 9-4 9 4-9 4-9-4Z" />
      <path d="m3 17 9-4 9 4-9 4-9-4Z" />
      <path d="m6.5 14.4 11-4.8" strokeWidth="2.5" />
    </svg>
  )
}

export function PierceIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="m3 12 9-4 9 4-9 4-9-4Z" />
      <path d="M12 2v20" />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none" />
    </svg>
  )
}
