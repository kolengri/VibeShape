import type { ReactNode, SVGProps } from "react"

export type ColoredIconProps = SVGProps<SVGSVGElement> & { size?: number | string }

/** Keep approved optical geometry independent of host text color and control size. */
export function coloredIcon(id: string, drawing: ReactNode) {
  function ColoredIcon({
    size = 20,
    width = size,
    height = size,
    children,
    ...props
  }: ColoredIconProps) {
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
        {drawing}
        {children}
      </svg>
    )
  }
  ColoredIcon.displayName = id
  return ColoredIcon
}
