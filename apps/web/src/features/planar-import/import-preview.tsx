import type { PreparedPlanarCurve } from "@vibeshape/domain/planar-import-authoring"
import type { PlanarInspection } from "./parser-contract"

function conicTransform(
  curve: Extract<PreparedPlanarCurve, { type: "ellipse" | "elliptical-arc" }>,
) {
  return `matrix(${curve.primaryAxis[0]} ${curve.primaryAxis[1]} ${curve.secondaryAxis[0]} ${curve.secondaryAxis[1]} ${curve.center[0]} ${curve.center[1]})`
}
function arcPath(start: number, sweep: number) {
  const end = start + sweep
  return `M${Math.cos(start)} ${Math.sin(start)} A1 1 0 ${sweep > Math.PI ? 1 : 0} 1 ${Math.cos(end)} ${Math.sin(end)}`
}
function PreviewCurve({ curve }: { curve: PreparedPlanarCurve }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    vectorEffect: "non-scaling-stroke",
  } as const
  switch (curve.type) {
    case "line":
      return <path {...stroke} d={`M${curve.start.join(" ")} L${curve.end.join(" ")}`} />
    case "cubic-bezier":
      return (
        <path
          {...stroke}
          d={`M${curve.start.join(" ")} C${curve.control1.join(" ")} ${curve.control2.join(" ")} ${curve.end.join(" ")}`}
        />
      )
    case "circle":
      return <circle {...stroke} cx={curve.center[0]} cy={curve.center[1]} r={curve.radius} />
    case "arc":
      return (
        <path
          {...stroke}
          d={arcPath(curve.startAngle, curve.sweep)}
          transform={`translate(${curve.center.join(" ")}) scale(${curve.radius})`}
        />
      )
    case "ellipse":
      return <circle {...stroke} cx={0} cy={0} r={1} transform={conicTransform(curve)} />
    case "elliptical-arc":
      return (
        <path
          {...stroke}
          d={arcPath(curve.startAngle, curve.sweep)}
          transform={conicTransform(curve)}
        />
      )
  }
}
export function PlanarImportPreview({
  inspection,
  label,
}: {
  inspection: PlanarInspection
  label: string
}) {
  const { min, max } = inspection.bounds
  const margin = Math.max(max[0] - min[0], max[1] - min[1], 1) * 0.08
  return (
    <svg
      role="img"
      aria-label={label}
      className="h-56 w-full rounded-md border bg-background text-primary"
      viewBox={`${min[0] - margin} ${-max[1] - margin} ${max[0] - min[0] + 2 * margin} ${max[1] - min[1] + 2 * margin}`}
    >
      <title>{label}</title>
      <g transform="scale(1,-1)">
        {inspection.prepared.paths.map((path) => (
          <g key={path.sourceOrdinal}>
            {path.segments.map((segment) => (
              <PreviewCurve key={segment.sourceOrdinal} curve={segment.curve} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  )
}
