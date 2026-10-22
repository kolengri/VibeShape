/** Reserves a CSS-pixel safe area without changing the model camera or projection. */
export function orientationInsetPlacement(
  width: number,
  height: number,
  leftOffset = 0,
  bottomOffset = 0,
  topOffset = 0,
) {
  const margin = 8
  return {
    x: leftOffset + margin,
    y: bottomOffset + margin,
    size: Math.max(
      0,
      Math.min(80, width - leftOffset - margin * 2, height - bottomOffset - topOffset - margin * 2),
    ),
  }
}
