export function StatusBar() {
  return (
    <footer
      className="flex items-center gap-4 border-t bg-toolbar px-2 text-xs text-muted-foreground"
      role="status"
    >
      <span>Units: mm</span>
      <span>Selection: Any</span>
      <span className="ml-auto">Ready</span>
    </footer>
  )
}
