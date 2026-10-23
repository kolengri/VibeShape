import type { ReactNode, SVGProps } from "react"
import { useId, useMemo } from "react"

export type ColoredIconProps = SVGProps<SVGSVGElement> & { size?: number | string }

/** Keep approved optical geometry independent of host text color and control size. */
export function coloredIcon(id: string, drawing: ReactNode | ((instanceId: string) => ReactNode)) {
  function ColoredIcon({
    size = 20,
    width = size,
    height = size,
    children,
    ...props
  }: ColoredIconProps) {
    const instanceId = useId()
    // Artwork depends only on its instance-local SVG IDs, not changing host control props.
    const artwork = useMemo(
      () => (typeof drawing === "function" ? drawing(instanceId) : drawing),
      [instanceId],
    )
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        fill="none"
        width={width}
        height={height}
        {...props}
        viewBox="0 0 256 256"
        data-icon={id}
      >
        {artwork}
        {children}
      </svg>
    )
  }
  ColoredIcon.displayName = id
  return ColoredIcon
}
