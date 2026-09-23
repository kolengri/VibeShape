/** Reserves a CSS-pixel safe area without changing the model camera or projection. */
export function orientationInsetPlacement(width: number, height: number, leftOffset = 0) {
  const margin = 8
  return {
    x: leftOffset + margin,
    y: margin,
    size: Math.max(0, Math.min(80, width - leftOffset - margin * 2, height - margin * 2)),
  }
}
