import { Button } from "@vibeshape/ui/components/button"

export function ApplicationBar() {
  return (
    <header className="flex min-w-0 items-center gap-3 border-b bg-toolbar px-2">
      <strong className="truncate text-sm">VibeShape</strong>
      <span className="truncate text-muted-foreground">Untitled project</span>
      <span className="ml-auto text-xs text-muted-foreground">Saved in this browser</span>
      <Button type="button" size="sm" variant="outline">
        Export…
      </Button>
    </header>
  )
}
