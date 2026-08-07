import { Button } from "@vibeshape/ui/components/button"

export function CommandToolbar() {
  return (
    <nav
      aria-label="Model commands"
      className="flex items-center gap-1 border-b bg-toolbar px-2"
      role="toolbar"
    >
      <Button type="button" size="sm" variant="secondary" aria-pressed="true">
        Model
      </Button>
      <Button type="button" size="sm" variant="ghost">
        Sketch
      </Button>
      <Button type="button" size="sm" variant="ghost">
        Print
      </Button>
      <span className="mx-1 h-5 border-l" aria-hidden="true" />
      <Button type="button" size="sm" variant="ghost">
        Create sketch
      </Button>
      <Button type="button" size="sm" variant="ghost">
        Extrude
      </Button>
    </nav>
  )
}
