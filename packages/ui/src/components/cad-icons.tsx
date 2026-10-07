import type { ReactNode, SVGProps } from "react"

function CadGlyph({
  children,
  ...props
}: SVGProps<SVGSVGElement> & Readonly<{ children: ReactNode }>) {
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
      {children}
    </svg>
  )
}

export function LightweightingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M4 21v-4c0-3.8 4-4.8 6-8V3h4v6c2 3.2 6 4.2 6 8v4h-4v-3.5c0-2.7-2.5-3.4-4-4.5-1.5 1.1-4 1.8-4 4.5V21H4Z" />
      <path d="M8 3h8M2 21h8m4 0h8" />
    </CadGlyph>
  )
}

export function QuickLightweightingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph strokeWidth="1.5" {...props}>
      <path d="m9 3.25 3 1.75 3-1.75L18 5v3.5l3 1.75v3.5l-3 1.75V19l-3 1.75L12 19l-3 1.75L6 19v-3.5l-3-1.75v-3.5L6 8.5V5l3-1.75Z" />
      <path d="m12 8.5 3 1.75v3.5l-3 1.75-3-1.75v-3.5L12 8.5Zm0 0V5m3 5.25 3-1.75m-3 5.25 3 1.75m-6 0V19m-3-5.25L6 15.5m3-5.25L6 8.5" />
    </CadGlyph>
  )
}

export function CylinderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 16c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </CadGlyph>
  )
}

export function SphereIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12c3 4 15 4 18 0" />
    </CadGlyph>
  )
}

export function ConeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M4 18 12 3l8 15" />
      <ellipse cx="12" cy="18" rx="8" ry="3" />
    </CadGlyph>
  )
}

export function TorusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <ellipse cx="12" cy="10" rx="9" ry="6" />
      <ellipse cx="12" cy="10" rx="3.5" ry="2" />
      <path d="M3 10v4c0 3.3 4 6 9 6s9-2.7 9-6v-4" />
    </CadGlyph>
  )
}

export function HoleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="m3 8 9-5 9 5v9l-9 5-9-5V8Zm0 0 9 5 9-5M12 13v9" />
      <ellipse cx="12" cy="8" rx="3" ry="1.5" />
    </CadGlyph>
  )
}

export function ExtrudeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="m3 13 7-4 7 4-7 4-7-4Zm0 0v6l7 4 7-4v-6M10 17v6M19 12V2m-3 3 3-3 3 3" />
    </CadGlyph>
  )
}

export function RevolveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M12 2v20M5 4h4v10H5V4M16 5c3 1 5 3.5 5 7s-2 6-5 7m0-4v4h4" />
      <path d="M3 18c2 2 5 3 9 3" strokeDasharray="2 3" />
    </CadGlyph>
  )
}

export function LoftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <ellipse cx="12" cy="4" rx="4" ry="2" />
      <path d="M8 4 3 18m13-14 5 14" />
      <ellipse cx="12" cy="18" rx="9" ry="4" />
    </CadGlyph>
  )
}

export function SweepIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <ellipse cx="5" cy="17" rx="3" ry="4" />
      <path d="M5 13h4c4 0 4-9 9-9h3M5 21h4c8 0 8-9 12-9" />
      <path d="M21 4v8" />
    </CadGlyph>
  )
}

export function FilletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M3 21V3h18M7 21v-5a9 9 0 0 1 9-9h5" />
      <path d="m10 10 5 5m-3 0h3v-3" />
    </CadGlyph>
  )
}

export function ChamferIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M3 21V3h18M7 21v-7l7-7h7" />
      <path d="m11 11 5 5m-3 0h3v-3" />
    </CadGlyph>
  )
}

export function SubtractIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M3 6h10v5H8v10H3V6Z" />
      <path d="M13 6h5v10H8v-5" strokeDasharray="2 3" />
      <path d="M17 3h5" />
    </CadGlyph>
  )
}

export function DatumPlaneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="m3 16 5-10h13l-5 10H3Z" />
      <path d="M12 21V3m-3 3 3-3 3 3" />
    </CadGlyph>
  )
}

export function PointIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M12 3v4m0 10v4M3 12h4m10 0h4" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </CadGlyph>
  )
}

export function DimensionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M4 4v16M20 4v16M4 8h16m-12-3-4 3 4 3m8-6 4 3-4 3M7 18h10" />
    </CadGlyph>
  )
}

export function MidpointLineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="m3 19 18-14m-15 4-3 3 3 3m12-6 3 3-3 3" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </CadGlyph>
  )
}

export function CenterRectangleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M3 5h18v14H3V5Z" />
      <path d="m3 5 18 14M3 19 21 5" strokeDasharray="2 3" strokeWidth="1" />
      <path d="M9 12h6m-3-3v6" />
    </CadGlyph>
  )
}

export function AlignedRectangleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="m3 13 12-9 6 8-12 9-6-8Z" />
      <path d="m3 13 12-9" strokeWidth="3" />
      <circle cx="3" cy="13" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="4" r="1.5" fill="currentColor" stroke="none" />
    </CadGlyph>
  )
}

export function CenteredAlignedRectangleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="m3 12 12-9 6 9-12 9-6-9Z" />
      <path d="m3 12 18 0M9 21 15 3" strokeDasharray="2 3" strokeWidth="1" />
      <path d="M9 12h6m-3-3v6" />
    </CadGlyph>
  )
}

export function SlotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </CadGlyph>
  )
}

export function CenteredSlotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <path d="M8 12h8m-4-4v8" />
    </CadGlyph>
  )
}

export function SlotAroundLineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <path d="M5 12h14M7 3v3m10 12v3" strokeDasharray="2 2" />
    </CadGlyph>
  )
}

export function CenterArcIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M4 12a8 8 0 0 1 16 0" />
      <path d="M4 12h8l5.7-5.7" strokeDasharray="2 3" strokeWidth="1" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </CadGlyph>
  )
}

export function ThreePointArcIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M3 17a9 9 0 0 1 18 0" />
      <circle cx="3" cy="17" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="2" fill="currentColor" stroke="none" />
      <circle cx="21" cy="17" r="2" fill="currentColor" stroke="none" />
    </CadGlyph>
  )
}

export function TangentArcIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M3 20h9a9 9 0 0 0 9-9V4" />
      <circle cx="12" cy="20" r="2" fill="currentColor" stroke="none" />
      <path d="M12 20h9" strokeDasharray="2 3" strokeWidth="1" />
    </CadGlyph>
  )
}

export function ThreePointCircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="4" r="2" fill="currentColor" stroke="none" />
      <circle cx="5.1" cy="16" r="2" fill="currentColor" stroke="none" />
      <circle cx="18.9" cy="16" r="2" fill="currentColor" stroke="none" />
    </CadGlyph>
  )
}

export function LinearPatternIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M2 12h5v7H2v-7Zm8 0h5v7h-5v-7Zm8 0h4v7h-4v-7ZM3 5h18m-3-3 3 3-3 3" />
    </CadGlyph>
  )
}

export function CircularPatternIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M8 4H4v4m0-4a9 9 0 0 1 15 0M7 19a9 9 0 0 0 10 0" />
      <rect x="2" y="10" width="5" height="5" rx="1" />
      <rect x="17" y="10" width="5" height="5" rx="1" />
      <rect x="9.5" y="2" width="5" height="5" rx="1" />
      <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
    </CadGlyph>
  )
}

export function OffsetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="M3 20V4h17M8 20V9h12m-7 6 5 5m-5 0h5v-5" />
    </CadGlyph>
  )
}

export function NormalViewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="m3 17 5-7h13l-5 7H3ZM12 13V2m-3 3 3-3 3 3" />
      <path d="M12 13h3v-3" />
    </CadGlyph>
  )
}

export function SurfaceTextureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CadGlyph {...props}>
      <path d="m3 16 5-12h13l-5 12H3Zm0 0v4h13l5-12V4M16 16v4M7 13l3-6m2 6 3-6" />
    </CadGlyph>
  )
}
