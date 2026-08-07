import { Button } from "@vibeshape/ui/components/button"

export function TaskPanel() {
  return (
    <aside aria-label="Task panel" className="min-h-0 overflow-auto border-l bg-panel p-4">
      <h2 className="text-sm font-medium">Start modeling</h2>
      <p className="mt-2 leading-5 text-muted-foreground">
        Select an origin plane, create a sketch, and preview each feature before applying it.
      </p>
      <Button type="button" className="mt-4 w-full">
        Create sketch
      </Button>
      <div className="mt-6 border-t pt-4">
        <h3 className="text-sm font-medium">Foundation status</h3>
        <ul className="mt-2 grid gap-2 text-muted-foreground">
          <li>Bun workspaces configured</li>
          <li>Shared UI tokens active</li>
          <li>Geometry engine not loaded</li>
        </ul>
      </div>
    </aside>
  )
}
