export function ViewportPlaceholder() {
  return (
    <section
      aria-label="3D viewport"
      className="relative grid min-h-0 place-items-center overflow-hidden bg-viewport-background"
    >
      <div className="max-w-sm px-6 text-center">
        <p className="text-sm font-medium">3D viewport</p>
        <p className="mt-2 text-muted-foreground">
          Geometry and worker integration arrive after the Phase 0 engine spikes.
        </p>
      </div>
      <div className="absolute bottom-3 left-3 rounded-sm border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
        XY · millimeters
      </div>
    </section>
  )
}
