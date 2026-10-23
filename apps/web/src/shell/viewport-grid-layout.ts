export type ViewportGridArea = "left" | "right" | "bottom"

export type ViewportGridItemConfiguration = {
  id: string
  area: ViewportGridArea
  visible?: boolean | undefined
  fullHeight?: boolean | undefined
  width?: number | undefined
  minWidth?: number | undefined
  maxWidth?: number | undefined
  onWidthChange?: ((width: number) => void) | undefined
  resizeLabel?: string | undefined
  onResetWidth?: (() => void) | undefined
  maxHeight?: string | undefined
  height?: string | undefined
  order?: number | undefined
  overlay?: boolean | undefined
  mobile?: { below: number; area: "bottom"; height: string } | undefined
}

export type ViewportGridEntry = ViewportGridItemConfiguration & {
  area: ViewportGridArea
  width: number
  fullHeight: boolean
}

export type ViewportGridLane = {
  id: string
  items: ViewportGridEntry[]
  fullHeight: boolean
  width: number
  minWidth: number
  maxWidth: number
  resizable: boolean
}

function positive(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

function makeLane(item: ViewportGridEntry): ViewportGridLane {
  const minWidth = positive(item.minWidth, 1)
  const maxWidth = Math.max(minWidth, positive(item.maxWidth, Number.MAX_SAFE_INTEGER))
  const width = Math.min(maxWidth, Math.max(minWidth, item.width))
  const resizable = !!item.onWidthChange
  return {
    id: `lane-${item.id}`,
    items: [item],
    fullHeight: item.fullHeight,
    width,
    minWidth,
    maxWidth,
    resizable,
  }
}

function canStack(
  lane: ViewportGridLane,
  next: ViewportGridLane,
  measured: number | undefined,
  space: { height: number; gap: number; occupiedHeight: number },
) {
  if (measured === undefined) return false
  return (
    !lane.fullHeight &&
    !next.fullHeight &&
    space.occupiedHeight > 0 &&
    space.occupiedHeight + space.gap + measured <= space.height &&
    Math.max(lane.minWidth, next.minWidth) <= Math.min(lane.maxWidth, next.maxWidth)
  )
}

function stackLane(lane: ViewportGridLane, next: ViewportGridLane) {
  lane.items.push(...next.items)
  lane.minWidth = Math.max(lane.minWidth, next.minWidth)
  lane.maxWidth = Math.min(lane.maxWidth, next.maxWidth)
  lane.width = Math.min(lane.maxWidth, Math.max(lane.minWidth, lane.width, next.width))
  lane.resizable = lane.minWidth < lane.maxWidth && lane.items.some((item) => !!item.onWidthChange)
}

function packSide(
  items: ViewportGridEntry[],
  heights: ReadonlyMap<string, number>,
  height: number,
  gap: number,
) {
  const lanes: ViewportGridLane[] = []
  let occupiedHeight = 0
  for (const item of items) {
    const next = makeLane(item)
    const previous = lanes.at(-1)
    const measured = heights.get(item.id)
    if (previous && canStack(previous, next, measured, { height, gap, occupiedHeight })) {
      stackLane(previous, next)
      occupiedHeight += gap + (measured ?? 0)
    } else {
      lanes.push(next)
      occupiedHeight = measured ?? 0
    }
  }
  return lanes
}

/** Ordered packing owns placement; widgets and their portal hosts have no layout identity. */
export function layoutViewportGrid(
  items: readonly ViewportGridItemConfiguration[],
  bounds: { width: number; bodyHeight: number; gap: number },
  heights: ReadonlyMap<string, number>,
) {
  const entries: ViewportGridEntry[] = items
    .filter((item) => item.visible !== false)
    .map((item) => {
      const mobile = item.mobile && bounds.width > 0 && bounds.width < item.mobile.below
      return {
        ...item,
        area: mobile ? ("bottom" as const) : item.area,
        height: mobile ? item.mobile?.height : item.height,
        width: positive(item.width, 320),
        fullHeight: item.fullHeight === true,
      }
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const side = entries.filter((item) => !item.overlay)
  return {
    left: packSide(
      side.filter((item) => item.area === "left"),
      heights,
      bounds.bodyHeight,
      bounds.gap,
    ),
    right: packSide(
      side.filter((item) => item.area === "right"),
      heights,
      bounds.bodyHeight,
      bounds.gap,
    ),
    bottom: entries.filter((item) => item.area === "bottom"),
    overlays: entries.filter((item) => item.overlay && item.area !== "bottom"),
  }
}

/** Capped content shares the budget left by explicit and naturally sized bottom entries. */
export function bottomContentHeight(
  items: readonly ViewportGridEntry[],
  heights: ReadonlyMap<string, number>,
  budget: number,
  gap: number,
) {
  const capped = items.filter((item) => item.maxHeight && !item.height)
  const fixed = items.reduce(
    (sum, item) => sum + (item.maxHeight && !item.height ? 0 : (heights.get(item.id) ?? 0)),
    0,
  )
  return (
    Math.max(0, budget - fixed - Math.max(0, items.length - 1) * gap) / Math.max(1, capped.length)
  )
}
