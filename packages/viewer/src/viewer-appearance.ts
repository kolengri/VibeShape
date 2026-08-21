const viewerBodyPalette = [
  "#9aaec1",
  "#7ca5c7",
  "#a2b997",
  "#c9a787",
  "#b994b4",
  "#8fb7b0",
] as const

function stableColorIndex(featureId: string) {
  let hash = 2_166_136_261
  for (const character of featureId) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % viewerBodyPalette.length
}

/**
 * Maps a terminal feature identity to a stable display-only body color.
 */
export function viewerBodyColor(featureId: string) {
  return viewerBodyPalette[stableColorIndex(featureId)]
}
