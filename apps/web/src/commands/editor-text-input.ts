export function hasTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return (
    target.matches(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
    ) ||
    target.closest("[contenteditable]:not([contenteditable='false']), [role='textbox']") !== null
  )
}
