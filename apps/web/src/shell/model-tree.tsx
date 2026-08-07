import { Button } from "@vibeshape/ui/components/button"

const modelItems = ["Origin", "Sketches", "Features", "Bodies"] as const

export function ModelTree() {
  return (
    <aside aria-label="Model tree" className="min-h-0 overflow-auto border-r bg-panel p-2">
      <h2 className="px-2 py-1 text-sm font-medium">Model tree</h2>
      <div className="mt-1 grid gap-0.5" role="tree" aria-label="Project features">
        {modelItems.map((item) => (
          <Button
            key={item}
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal"
            role="treeitem"
          >
            {item}
          </Button>
        ))}
      </div>
    </aside>
  )
}
