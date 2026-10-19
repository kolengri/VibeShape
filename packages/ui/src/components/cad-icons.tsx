import type { ReactNode, SVGProps } from "react"

/** CAD glyphs share an optical grid; their host owns size, color, and accessible copy. */
function cadIcon(drawing: ReactNode) {
  return function CadIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        aria-hidden="true"
        fill="none"
        focusable="false"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
        {...props}
      >
        {drawing}
      </svg>
    )
  }
}

function point(cx: number, cy: number, radius = 1.6) {
  return <circle cx={cx} cy={cy} r={radius} fill="currentColor" stroke="none" />
}

const block = (
  <>
    <path d="m3 7.5 9-5 9 5v10l-9 5-9-5v-10Z" />
    <path d="m3 7.5 9 5 9-5m-9 5v10" />
  </>
)
export const PrimitiveBoxIcon = cadIcon(block)
export const CylinderIcon = cadIcon(
  <>
    <path d="M4 6v12c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5V6" />
    <ellipse cx="12" cy="6" rx="8" ry="3.5" fill="currentColor" fillOpacity="0.12" />
  </>,
)
export const SphereIcon = cadIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <ellipse cx="12" cy="12" rx="3.8" ry="9" />
    <path d="M3 12c3 4.5 15 4.5 18 0" />
  </>,
)
export const ConeIcon = cadIcon(
  <>
    <path d="m4 18 8-15 8 15" />
    <ellipse cx="12" cy="18" rx="8" ry="3.5" fill="currentColor" fillOpacity="0.12" />
  </>,
)
export const PrimitivePyramidIcon = cadIcon(
  <>
    <path d="m12 2 9 15-9 5-9-5L12 2Z" />
    <path d="M3 17l9-5 9 5" strokeDasharray="2 3" />
    <path d="M12 2v20" />
  </>,
)
export const TorusIcon = cadIcon(
  <>
    <ellipse cx="12" cy="10" rx="9" ry="5.5" />
    <ellipse cx="12" cy="10" rx="3.4" ry="1.8" />
    <path d="M3 10v4c0 3 4 5.5 9 5.5s9-2.5 9-5.5v-4" />
  </>,
)

export const ExtrudeIcon = cadIcon(
  <>
    <path d="m3 12 7-4 7 4-7 4-7-4Zm0 0v6l7 4 7-4v-6m-7 4v6" />
    <path d="m3 15 7 4 7-4" strokeOpacity="0.45" />
    <path d="M20 11V2m-3 3 3-3 3 3" strokeWidth="2.2" />
  </>,
)
export const RevolveIcon = cadIcon(
  <>
    <path d="M11 3v18" strokeDasharray="2 3" />
    <path d="M4 6h4v12H4z" fill="currentColor" fillOpacity="0.16" />
    <path d="M15 5c4 1 6 4 6 7s-2 6-6 7m0-4v4h4" strokeWidth="2.2" />
    <path d="M3 20c2 1 5 1.5 8 1.5" />
  </>,
)
export const LoftIcon = cadIcon(
  <>
    <ellipse cx="12" cy="5" rx="4.5" ry="2.5" />
    <path d="M7.5 5c0 6-4.5 8-4.5 13m13.5-13c0 6 4.5 8 4.5 13" />
    <ellipse cx="12" cy="18" rx="9" ry="3.5" fill="currentColor" fillOpacity="0.12" />
  </>,
)
export const SweepIcon = cadIcon(
  <>
    <path d="M5 13h3c5 0 4-9 10-9h3v8c-6 0-5 9-13 9H5" />
    <ellipse cx="5" cy="17" rx="2.7" ry="4" fill="currentColor" fillOpacity="0.12" />
    <path d="M10 17c5-1 5-9 11-9" strokeDasharray="2 3" />
  </>,
)
export const HoleIcon = cadIcon(
  <>
    {block}
    <ellipse cx="12" cy="7.5" rx="3.5" ry="1.8" fill="currentColor" fillOpacity="0.16" />
    <path d="M8.5 7.5v3m7-3v3" strokeDasharray="1.5 2" />
  </>,
)
export const FilletIcon = cadIcon(
  <>
    <path d="M3 21V9h7a7 7 0 0 1 7 7v5H3Zm0-12 5-5h7a7 7 0 0 1 7 7v5l-5 5" />
    <path d="m10 9 5-5m2 12 5-5" />
    <path d="M10 9a7 7 0 0 1 7 7l5-5a7 7 0 0 0-7-7Z" fill="currentColor" fillOpacity="0.18" />
  </>,
)
export const ChamferIcon = cadIcon(
  <>
    <path d="M3 21V9h7l7 7v5H3Zm0-12 5-5h7l7 7v5l-5 5" />
    <path d="m10 9 5-5m2 12 5-5" />
    <path d="m10 9 7 7 5-5-7-7Z" fill="currentColor" fillOpacity="0.18" />
  </>,
)
export const ShellIcon = cadIcon(
  <>
    {block}
    <path d="m6.5 7.5 5.5-3 5.5 3-5.5 3-5.5-3Z" fill="currentColor" fillOpacity="0.16" />
  </>,
)
export const ThreadIcon = cadIcon(
  <>
    <ellipse cx="12" cy="5" rx="7" ry="2.5" />
    <path d="M5 5v14c0 1.5 3 2.5 7 2.5s7-1 7-2.5V5M5 10l14-3M5 14l14-3M5 18l14-3" />
  </>,
)
export const CompoundIcon = cadIcon(
  <>
    <path d="m2 5 5-3 5 3v6l-5 3-5-3V5Zm0 0 5 3 5-3M7 8v6" />
    <path d="m12 13 5-3 5 3v6l-5 3-5-3v-6Zm0 0 5 3 5-3m-5 3v6" />
  </>,
)
export const UnionIcon = cadIcon(
  <>
    <path d="m3 7 7-4 7 4v3l4 2v7l-7 4-7-4v-3l-4-2V7Z" fill="currentColor" fillOpacity="0.12" />
    <path d="m3 7 7 4 7-4m-7 4v4l4 2 7-5m-7 5v6M7 16l3-1" />
  </>,
)
export const SubtractIcon = cadIcon(
  <>
    <path d="m3 7 8-4 4 2v6l6 3v4l-9 4-9-5V7Zm0 0 9 5 3-1m-3 1v10m0-7 9-1" />
    <path d="m15 5 6 3v6m-6-9v6l6 3" strokeDasharray="2 3" />
    <path d="M17 2h5" strokeWidth="2.2" />
  </>,
)
export const SketchSplitIcon = cadIcon(
  <>
    <path d="M3 21 9 15m6-6 6-6" />
    <circle cx="10.5" cy="13.5" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="13.5" cy="10.5" r="1.7" fill="currentColor" stroke="none" />
    <path d="m6 5 13 13" strokeDasharray="2 3" strokeOpacity="0.45" />
  </>,
)
export const SplitBodyIcon = cadIcon(
  <>
    <path d="m2 7 7-4 3 1.7v14.6L9 21l-7-4V7Zm0 0 7 4 3-1.7M9 11v10" />
    <path d="m15 4.7 7 4v10l-7 4V4.7Zm0 10 7-4" />
    <path d="M13.5 2v20" strokeDasharray="2 3" strokeOpacity="0.45" />
  </>,
)
export const MirrorIcon = cadIcon(
  <>
    <path d="M12 2v20" strokeDasharray="2 3" />
    <path d="M3 6v12h5L3 6Zm18 0v12h-5l5-12Z" />
    <path d="M3 6v12h5Z" fill="currentColor" fillOpacity="0.16" />
  </>,
)
export const LinearPatternIcon = cadIcon(
  <>
    <path d="M2 11h5v8H2zM9.5 11h5v8h-5zM17 11h5v8h-5z" />
    <path d="M3 5h18m-3-3 3 3-3 3" strokeWidth="2.2" />
  </>,
)
export const CircularPatternIcon = cadIcon(
  <>
    <path d="M9 2h6v6H9zM2 15h6v6H2zM16 15h6v6h-6z" />
    <path d="M5 12a7 7 0 0 1 2-4m10 0a7 7 0 0 1 2 4m-9 8h4" />
    {point(12, 13, 1.2)}
  </>,
)
export const LightweightingIcon = cadIcon(
  <>
    <path
      d="M9 3h6v5c0 3 5 5 5 9v4h-5v-4c0-1.5-1.5-2.5-3-3.5C10.5 14.5 9 15.5 9 17v4H4v-4c0-4 5-6 5-9V3Z"
      fill="currentColor"
      fillOpacity="0.12"
    />
    <path d="M7 3h10M2 21h9m2 0h9" />
  </>,
)
export const QuickLightweightingIcon = cadIcon(
  <path d="m7 2 5 3v6l-5 3-5-3V5l5-3Zm10 0 5 3v6l-5 3-5-3V5l5-3ZM12 11l5 3v6l-5 3-5-3v-6l5-3Z" />,
)
export const SurfaceTextureIcon = cadIcon(
  <>
    <path d="m3 13 6-9h13l-6 9H3Zm0 0v5h13l6-9V4m-6 9v5" />
    <path d="m8 10 2-3m3 3 2-3m3 3 2-3" strokeWidth="2.2" />
  </>,
)
export const DatumPlaneIcon = cadIcon(
  <>
    <path d="m3 17 5-10h13l-5 10H3Z" fill="currentColor" fillOpacity="0.12" />
    <path d="M12 21V3m-3 3 3-3 3 3" />
  </>,
)
export const SketchIcon = cadIcon(
  <>
    <path d="M12 5H4v15h15v-8" />
    <path d="m9 15 1-4 9-9 3 3-9 9-4 1Z" fill="currentColor" fillOpacity="0.12" />
    <path d="m17 4 3 3" />
  </>,
)
export const SketchLineIcon = cadIcon(
  <>
    {point(4, 20)}
    {point(20, 4)}
    <path d="M4 20 20 4" />
  </>,
)
export const SketchCircleIcon = cadIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    {point(12, 12, 1.3)}
  </>,
)
export const SketchRectangleIcon = cadIcon(
  <>
    <path d="M3 5h18v14H3z" />
    {point(3, 5)}
    {point(21, 19)}
  </>,
)
export const SketchSplineIcon = cadIcon(
  <>
    <path d="M3 18c7 0 1-12 8-12s3 12 10 12" />
    {point(3, 18)}
    {point(11, 6)}
    {point(21, 18)}
  </>,
)
export const SketchConstructionIcon = cadIcon(
  <>
    <path d="M4 20 20 4" strokeDasharray="3 3" />
    <circle cx="4" cy="20" r="1.7" />
    <circle cx="20" cy="4" r="1.7" />
  </>,
)
export const ExtendIcon = cadIcon(
  <>
    <path d="M3 20 12 11" />
    <path d="m12 11 9-9m-6 0h6v6" strokeDasharray="2 3" />
    {point(12, 11)}
  </>,
)
export const PointIcon = cadIcon(
  <>
    <path d="M12 3v4m0 10v4M3 12h4m10 0h4" />
    {point(12, 12, 2.2)}
  </>,
)
export const DimensionIcon = cadIcon(<path d="M4 4v16M20 4v16M4 9h16m-12-3-4 3 4 3m8-6 4 3-4 3" />)
export const MidpointLineIcon = cadIcon(
  <>
    <path d="M3 19 21 5m-18 9v5h5m8-14h5v5" />
    {point(12, 12, 2)}
  </>,
)
export const CenterRectangleIcon = cadIcon(
  <>
    <path d="M3 5h18v14H3z" />
    <path d="m4 6 16 12M4 18 20 6" strokeDasharray="2 3" strokeOpacity="0.45" />
    {point(12, 12, 1.8)}
  </>,
)
export const AlignedRectangleIcon = cadIcon(
  <>
    <path d="m3 13 12-9 6 8-12 9-6-8Z" />
    {point(3, 13)}
    {point(15, 4)}
  </>,
)
export const CenteredAlignedRectangleIcon = cadIcon(
  <>
    <path d="m3 12 12-9 6 9-12 9-6-9Z" />
    <path d="M4 12h16M10 20l4-16" strokeDasharray="2 3" strokeOpacity="0.45" />
    {point(12, 12, 1.8)}
  </>,
)
export const SlotIcon = cadIcon(
  <>
    <rect x="2" y="7" width="20" height="10" rx="5" />
    {point(7, 12)}
    {point(17, 12)}
  </>,
)
export const CenteredSlotIcon = cadIcon(
  <>
    <rect x="2" y="7" width="20" height="10" rx="5" />
    <path d="M8 12h8m-4-3v6" />
  </>,
)
export const SlotAroundLineIcon = cadIcon(
  <>
    <rect x="2" y="7" width="20" height="10" rx="5" />
    <path d="M4 12h16" strokeDasharray="3 3" />
  </>,
)
export const CenterArcIcon = cadIcon(
  <>
    <path d="M3 16a9 9 0 0 1 18 0" />
    <path d="M3 16h9l6.4-6.4" strokeDasharray="2 3" strokeOpacity="0.5" />
    {point(12, 16)}
  </>,
)
export const ThreePointArcIcon = cadIcon(
  <>
    <path d="M3 17a9 9 0 0 1 18 0" />
    {point(3, 17)}
    {point(12, 8)}
    {point(21, 17)}
  </>,
)
export const TangentArcIcon = cadIcon(
  <>
    <path d="M3 20h9a9 9 0 0 0 9-9V4" />
    {point(12, 20)}
    <path d="M14 20h7" strokeDasharray="2 3" strokeOpacity="0.5" />
  </>,
)
export const ThreePointCircleIcon = cadIcon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    {point(12, 3.5)}
    {point(4.6, 16.25)}
    {point(19.4, 16.25)}
  </>,
)
export const OffsetIcon = cadIcon(<path d="M3 21V4h18M8 21V9h13m-9 5 7 7m-5 0h5v-5" />)
export const NormalViewIcon = cadIcon(
  <>
    <path d="m3 18 5-8h13l-5 8H3Z" fill="currentColor" fillOpacity="0.12" />
    <path d="M12 14V2m-3 3 3-3 3 3m-3 12h3v-3" />
  </>,
)

export const ConstraintCoincidentIcon = cadIcon(
  <>
    <path d="m3 3 6 6m6 6 6 6M3 21l6-6m6-6 6-6" />
    <circle cx="12" cy="12" r="3.5" />
    {point(12, 12, 1.3)}
  </>,
)
export const ConstraintConcentricIcon = cadIcon(
  <>
    <circle cx="12" cy="12" r="3.5" />
    <circle cx="12" cy="12" r="8.5" />
  </>,
)
export const ConstraintEqualIcon = cadIcon(<path d="M4 8h16M4 16h16" strokeWidth="2.2" />)
export const ConstraintFixedIcon = cadIcon(
  <>
    <rect x="5" y="10" width="14" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    {point(12, 15, 1.3)}
  </>,
)
export const ConstraintHorizontalIcon = cadIcon(
  <>
    <path d="M4 12h16" />
    {point(4, 12)}
    {point(20, 12)}
  </>,
)
export const ConstraintVerticalIcon = cadIcon(
  <>
    <path d="M12 4v16" />
    {point(12, 4)}
    {point(12, 20)}
  </>,
)
export const ConstraintMidpointIcon = cadIcon(
  <>
    <path d="m3 19 9-15 9 15H3Z" />
    {point(12, 19, 2.3)}
  </>,
)
export const ConstraintParallelIcon = cadIcon(<path d="M4 15 15 4M9 20 20 9" strokeWidth="2.2" />)
export const ConstraintPerpendicularIcon = cadIcon(<path d="M5 4v15h15M5 13h6v6" strokeWidth="2" />)
export const ConstraintPointOnCurveIcon = cadIcon(
  <>
    <path d="M3 17a9 9 0 0 1 18 0" />
    {point(12, 8, 2.3)}
  </>,
)
export const ConstraintPointOnLineIcon = cadIcon(
  <>
    <path d="M3 18 21 6" />
    {point(12, 12, 2.3)}
  </>,
)
export const ConstraintSymmetricIcon = cadIcon(
  <>
    <path d="M12 2v20" strokeDasharray="2 3" />
    <path d="m3 7 5 5-5 5m18-10-5 5 5 5" />
  </>,
)
export const ConstraintTangentIcon = cadIcon(
  <>
    <circle cx="12" cy="14" r="6.5" />
    <path d="M3 7.5h18" strokeWidth="2.2" />
  </>,
)
export const InscribedPolygonIcon = cadIcon(
  <>
    <circle cx="12" cy="12" r="9.5" strokeOpacity="0.55" />
    <path d="m12 5.5 5.6 3.25v6.5L12 18.5l-5.6-3.25v-6.5L12 5.5Z" />
  </>,
)
export const CircumscribedPolygonIcon = cadIcon(
  <>
    <circle cx="12" cy="12" r="5.5" strokeOpacity="0.55" />
    <path d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Z" />
  </>,
)
export const EllipseIcon = cadIcon(
  <>
    <ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-30 12 12)" />
    <path d="m4.2 16.5 15.6-9" strokeDasharray="2 3" strokeOpacity="0.45" />
    {point(12, 12, 1.3)}
  </>,
)
export const EllipticalArcIcon = cadIcon(
  <>
    <path d="M4 16.6c2.5 4.3 10.5 3.4 15-1.5 3-3.3 3.5-7.3 1-9.6" />
    <path d="M4 16.6 20 5.5" strokeDasharray="2 3" strokeOpacity="0.45" />
    {point(4, 16.6)}
    {point(20, 5.5)}
  </>,
)
export const FinalResultIcon = cadIcon(
  <>
    <path d="M4 5h8M4 12h8M4 19h8m5-16v18m-5-9h5m0 0h4" />
    {point(4, 5, 1.3)}
    {point(4, 12, 1.3)}
    {point(4, 19, 1.3)}
  </>,
)
export const IntersectionIcon = cadIcon(
  <>
    <path d="m3 7 9-4 9 4-9 4-9-4Zm0 10 9-4 9 4-9 4-9-4Z" />
    <path d="m6 15 12-6" strokeWidth="2.6" />
  </>,
)
export const PierceIcon = cadIcon(
  <>
    <path d="m3 13 9-5 9 5-9 5-9-5Z" />
    <path d="M12 2v20" />
    {point(12, 13, 2.3)}
  </>,
)

export const SectionViewIcon = cadIcon(
  <>
    <path d="m3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5m-9 5v10" />
    <path d="m3 7 9 5v10l-9-5V7Z" fill="currentColor" fillOpacity="0.16" />
    <path d="M3 11l3.6-2M3 15l7.2-4m-3.6 8 5.4-3m-1.8 5 1.8-1" strokeWidth="1.3" />
  </>,
)

export const AssemblyJointIcon = cadIcon(
  <>
    <path d="M3 4v5l5 3-5 3v5M21 4v5l-5 3 5 3v5M8 12h1m6 0h1" />
    <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.12" />
  </>,
)

export const AssemblyInstanceIcon = cadIcon(
  <>
    <path d="m3 10 6-3 6 3v8l-6 3-6-3v-8Zm0 0 6 3 6-3m-6 3v8" />
    <path d="m10 4 5-2 6 3v8l-3 1m-8-10 5 3 6-2m-6 2v3" />
  </>,
)

export const RigidGroupIcon = cadIcon(
  <>
    <path d="M5 8V3h14v5M12 3v14M5 14v6h4m10-6v6h-4" />
    <path d="M2 8h6v6H2zM16 8h6v6h-6zM9 17h6v6H9z" fill="currentColor" fillOpacity="0.12" />
  </>,
)

export const MotionStudyIcon = cadIcon(
  <>
    <path d="M3 18c0-6 3-9 8-9m-5 9h7" />
    {point(3, 18, 2)}
    {point(10, 9, 1.6)}
    <path d="m15 4 7 6-7 6V4Z" fill="currentColor" fillOpacity="0.12" />
  </>,
)
