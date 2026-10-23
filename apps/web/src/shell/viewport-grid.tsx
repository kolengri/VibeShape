import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@vibeshape/ui/components/resizable"
import {
  createContext,
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  bottomContentHeight,
  layoutViewportGrid,
  type ViewportGridEntry,
  type ViewportGridItemConfiguration,
  type ViewportGridLane,
} from "./viewport-grid-layout"

type Registration = ViewportGridItemConfiguration & { host: HTMLDivElement }
type Bounds = {
  width: number
  workbenchWidth: number
  height: number
  bodyTop: number
  bodyHeight: number
  gap: number
  bottomBudget: number
}
type GridContext = {
  register: (item: Registration) => void
  unregister: (id: string, host: HTMLDivElement) => void
  bottom: ViewportGridEntry[]
  items: ReadonlyMap<string, Registration>
  bottomCap: number
}
const Context = createContext<GridContext | null>(null)

function useGrid() {
  const value = useContext(Context)
  if (!value) throw new Error("Viewport grid items must be inside ViewportGrid")
  return value
}

function sameMeasurements(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) {
  return a.size === b.size && [...a].every(([id, value]) => b.get(id) === value)
}

type GridMeasurement = { rect: DOMRect; body: DOMRect; bounds: Bounds }
type OccupiedRegion = { item: Registration; rect: DOMRect }

function measureBounds(element: HTMLDivElement): GridMeasurement {
  const rect = element.getBoundingClientRect()
  const body =
    element.querySelector<HTMLElement>(".editor-model-area")?.getBoundingClientRect() ?? rect
  const workbench = element.querySelector<HTMLElement>(".editor-workbench")?.getBoundingClientRect()
  const footer = element
    .querySelector<HTMLElement>(".editor-workbench > footer")
    ?.getBoundingClientRect()
  const gap =
    element.querySelector<HTMLElement>("[data-viewport-gap]")?.getBoundingClientRect().width ?? 8
  const bodyTop = Math.max(0, body.top - rect.top)
  return {
    rect,
    body,
    bounds: {
      width: rect.width,
      workbenchWidth: workbench?.width ?? rect.width,
      height: rect.height,
      bodyTop,
      bodyHeight: body.height,
      gap,
      bottomBudget: Math.max(0, rect.height - bodyTop - (footer?.height ?? 0) - 2 * gap),
    },
  }
}

function occupiedInsets(
  regions: OccupiedRegion[],
  { rect, body, bounds }: GridMeasurement,
  scene: DOMRect,
) {
  const { gap } = bounds
  const insets = {
    left: 0,
    right: 0,
    top: Math.min(rect.height, bounds.bodyTop + rect.top - scene.top),
    bottom: Math.max(0, scene.bottom - body.bottom - gap),
  }
  for (const { item, rect: occupied } of regions) {
    if (occupied.width <= 0 || occupied.height <= 0) continue
    const area = item.host.dataset.viewportArea
    if (area === "left") insets.left = Math.max(insets.left, occupied.right - scene.left + gap)
    if (area === "right") insets.right = Math.max(insets.right, scene.right - occupied.left + gap)
    if (area === "bottom") insets.bottom = Math.max(insets.bottom, scene.bottom - occupied.top)
  }
  return insets
}

function measureOccupiedRegions(
  element: HTMLDivElement,
  items: ReadonlyMap<string, Registration>,
  measurement: GridMeasurement,
) {
  const regions = [...items.values()]
    .filter((item) => !item.host.hidden)
    .map((item) => ({ item, rect: item.host.getBoundingClientRect() }))
  const scene =
    element.querySelector<HTMLElement>(".workspace-viewport")?.getBoundingClientRect() ??
    measurement.rect
  for (const [edge, pixels] of Object.entries(occupiedInsets(regions, measurement, scene))) {
    element.style.setProperty(`--workspace-chrome-${edge}`, `${pixels}px`)
  }
  const fullHeight = regions.filter(({ item }) => item.fullHeight && !item.overlay)
  for (const area of ["left", "right"] as const) {
    const inset = fullHeight
      .filter(({ item }) => item.host.dataset.viewportArea === area)
      .reduce(
        (inset, { rect }) =>
          Math.max(
            inset,
            (area === "left"
              ? rect.right - measurement.rect.left
              : measurement.rect.right - rect.left) + measurement.bounds.gap,
          ),
        0,
      )
    element.style.setProperty(`--viewport-${area}-inset`, `${inset}px`)
  }
  return new Map(
    regions.filter(({ rect }) => rect.height > 0).map(({ item, rect }) => [item.id, rect.height]),
  )
}

function observeGrid(
  element: HTMLDivElement,
  items: ReadonlyMap<string, Registration>,
  request: () => void,
) {
  const observer = new ResizeObserver(request)
  observer.observe(element)
  for (const selector of [
    ".editor-model-area",
    ".editor-workbench",
    ".editor-workbench > footer",
    "[data-viewport-slot='bottom']",
  ]) {
    const node = element.querySelector(selector)
    if (node) observer.observe(node)
  }
  for (const item of items.values()) observer.observe(item.host)
  return observer
}

function useMeasurements(
  root: RefObject<HTMLDivElement | null>,
  items: ReadonlyMap<string, Registration>,
) {
  const [bounds, setBounds] = useState<Bounds>({
    width: 0,
    workbenchWidth: 0,
    height: 0,
    bodyTop: 0,
    bodyHeight: 0,
    gap: 8,
    bottomBudget: 0,
  })
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map())
  const schedule = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    let frame = 0
    const measure = () => {
      frame = 0
      const measurement = measureBounds(element)
      const next = measurement.bounds
      setBounds((old) =>
        Object.keys(next).every((key) => Reflect.get(old, key) === Reflect.get(next, key))
          ? old
          : next,
      )
      const measured = measureOccupiedRegions(element, items, measurement)
      setHeights((old) => (sameMeasurements(old, measured) ? old : measured))
    }
    const request = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    schedule.current = request
    const observer = observeGrid(element, items, request)
    window.addEventListener("resize", request)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", request)
      cancelAnimationFrame(frame)
      schedule.current = () => {}
    }
  }, [root, items])
  return { bounds, heights, schedule }
}

/** The declaration owns React context; only this item's DOM host changes lanes. */
export function ViewportGridItem({
  children,
  ...item
}: ViewportGridItemConfiguration & { children: ReactNode }) {
  const { register, unregister } = useGrid()
  const [host] = useState(() => document.createElement("div"))
  const {
    id,
    area,
    visible,
    fullHeight,
    width,
    minWidth,
    maxWidth,
    onWidthChange,
    resizeLabel,
    onResetWidth,
    maxHeight,
    height,
    order,
    overlay,
  } = item
  const mobileBelow = item.mobile?.below
  const mobileArea = item.mobile?.area
  const mobileHeight = item.mobile?.height
  useLayoutEffect(() => {
    host.id = id
    host.className = "viewport-grid__item"
    host.dataset.viewportItem = id
    register({
      id,
      area,
      visible,
      fullHeight,
      width,
      minWidth,
      maxWidth,
      onWidthChange,
      resizeLabel,
      onResetWidth,
      maxHeight,
      height,
      order,
      overlay,
      host,
      mobile:
        mobileBelow !== undefined && mobileArea && mobileHeight !== undefined
          ? { below: mobileBelow, area: mobileArea, height: mobileHeight }
          : undefined,
    })
  }, [
    register,
    host,
    id,
    area,
    visible,
    fullHeight,
    width,
    minWidth,
    maxWidth,
    onWidthChange,
    resizeLabel,
    onResetWidth,
    maxHeight,
    height,
    order,
    overlay,
    mobileBelow,
    mobileArea,
    mobileHeight,
  ])
  useLayoutEffect(() => () => unregister(id, host), [id, host, unregister])
  return createPortal(children, host, id)
}

function itemHeight(item: ViewportGridEntry) {
  if (item.area === "bottom") return item.height ?? ""
  return item.fullHeight ? "100%" : (item.height ?? "")
}

function itemPresentation(item: ViewportGridEntry, cap: number | undefined) {
  const available = cap === undefined ? "100%" : `${Math.max(0, cap)}px`
  return {
    fullHeight: item.fullHeight && item.area !== "bottom",
    height: itemHeight(item),
    maxHeight: item.maxHeight ? `min(${item.maxHeight}, ${available})` : available,
  }
}

function ItemHost({
  item,
  registration,
  cap,
}: {
  item: ViewportGridEntry
  registration: Registration | undefined
  cap: number | undefined
}) {
  const anchor = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = registration?.host
    const parent = anchor.current
    if (!host || !parent) return
    // Moving an existing portal container retains context, uncontrolled inputs and widget state.
    parent.append(host)
    const presentation = itemPresentation(item, cap)
    host.hidden = false
    host.dataset.viewportArea = item.area
    host.dataset.fullHeight = String(presentation.fullHeight)
    host.style.height = presentation.height
    host.style.maxHeight = presentation.maxHeight
  }, [item.area, item.fullHeight, item.height, item.maxHeight, registration, cap])
  return (
    <div
      ref={anchor}
      className="viewport-grid__mount"
      data-full-height={item.fullHeight && item.area !== "bottom"}
    />
  )
}

function LaneHost({
  lane,
  items,
  bounds,
  setElement,
}: {
  lane: ViewportGridLane
  items: ReadonlyMap<string, Registration>
  bounds: Bounds
  setElement: (id: string, node: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={(node) => setElement(lane.id, node)}
      className="viewport-grid__lane"
      data-viewport-lane={lane.id}
      data-full-height={lane.fullHeight}
      style={{
        width: lane.width,
        top: lane.fullHeight ? 0 : bounds.bodyTop,
        height: lane.fullHeight ? "100%" : bounds.bodyHeight,
      }}
    >
      {lane.items.map((item) => (
        <ItemHost
          key={item.id}
          item={item}
          registration={items.get(item.id)}
          cap={lane.fullHeight ? undefined : bounds.bodyHeight}
        />
      ))}
    </div>
  )
}

function LanePanel({
  lane,
  panelRefs,
  onResize,
}: {
  lane: ViewportGridLane
  panelRefs: RefObject<Map<string, PanelImperativeHandle>>
  onResize: (id: string, width: number) => void
}) {
  const ref = useRef<PanelImperativeHandle | null>(null)
  useLayoutEffect(() => {
    const panel = ref.current
    if (!panel) return
    panelRefs.current.set(lane.id, panel)
    // The Group registers after its child panels' layout effects.
    const frame = requestAnimationFrame(() => panel.resize(lane.width))
    return () => {
      cancelAnimationFrame(frame)
      panelRefs.current.delete(lane.id)
    }
  }, [lane.id, lane.width, panelRefs])
  return (
    <ResizablePanel
      id={lane.id}
      panelRef={ref}
      defaultSize={lane.width}
      minSize={lane.resizable ? lane.minWidth : lane.width}
      maxSize={lane.resizable ? lane.maxWidth : lane.width}
      disabled={!lane.resizable}
      groupResizeBehavior="preserve-pixel-size"
      aria-hidden="true"
      className="viewport-grid__sizing-panel"
      onResize={({ inPixels }) => onResize(lane.id, inPixels)}
    />
  )
}

function LaneSeparator({ lane, bounds }: { lane: ViewportGridLane; bounds: Bounds }) {
  if (!lane.resizable) return <div className="viewport-grid__gap" aria-hidden="true" />
  const owner = lane.items.find((item) => item.onWidthChange)
  return (
    <ResizableHandle
      aria-label={owner?.resizeLabel ?? lane.items[0]?.id}
      disableDoubleClick
      onDoubleClick={owner?.onResetWidth}
      className="viewport-grid__resize"
      style={{
        marginTop: lane.fullHeight ? 0 : bounds.bodyTop,
        height: lane.fullHeight ? "100%" : bounds.bodyHeight,
      }}
    />
  )
}

export function ViewportGridBottom() {
  const { bottom, items, bottomCap } = useGrid()
  return (
    <div className="viewport-grid__bottom" data-viewport-slot="bottom" hidden={bottom.length === 0}>
      {bottom.map((item) => (
        <ItemHost
          key={item.id}
          item={item}
          registration={items.get(item.id)}
          cap={item.maxHeight && !item.height ? bottomCap : undefined}
        />
      ))}
    </div>
  )
}

function useRegistry() {
  const [items, setItems] = useState<ReadonlyMap<string, Registration>>(new Map())
  const register = useCallback(
    (item: Registration) => setItems((old) => new Map(old).set(item.id, item)),
    [],
  )
  const unregister = useCallback((id: string, host: HTMLDivElement) => {
    setItems((old) => {
      if (old.get(id)?.host !== host) return old
      const next = new Map(old)
      next.delete(id)
      return next
    })
    host.remove()
  }, [])
  return { items, register, unregister }
}

function useLaneSizing(schedule: RefObject<() => void>) {
  const laneElements = useRef(new Map<string, HTMLDivElement>())
  const laneWidths = useRef(new Map<string, number>())
  const setLaneElement = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      laneElements.current.set(id, node)
      const width = laneWidths.current.get(id)
      if (width !== undefined) node.style.width = `${width}px`
    } else laneElements.current.delete(id)
  }, [])
  const resize = useCallback(
    (id: string, width: number) => {
      laneWidths.current.set(id, width)
      const element = laneElements.current.get(id)
      if (element) element.style.width = `${width}px`
      schedule.current()
    },
    [schedule],
  )
  return { setLaneElement, resize }
}

type GridLayout = ReturnType<typeof layoutViewportGrid>

function GridSlots({
  layout,
  bounds,
  setLaneElement,
}: {
  layout: GridLayout
  bounds: Bounds
  setLaneElement: (id: string, node: HTMLDivElement | null) => void
}) {
  const { items } = useGrid()
  return (
    <>
      <div className="viewport-grid__side viewport-grid__side--left" data-viewport-slot="left">
        {layout.left.map((lane) => (
          <LaneHost
            key={lane.id}
            lane={lane}
            items={items}
            bounds={bounds}
            setElement={setLaneElement}
          />
        ))}
      </div>
      <div className="viewport-grid__side viewport-grid__side--right" data-viewport-slot="right">
        {layout.right.map((lane) => (
          <LaneHost
            key={lane.id}
            lane={lane}
            items={items}
            bounds={bounds}
            setElement={setLaneElement}
          />
        ))}
      </div>
      <div className="viewport-grid__overlays">
        {layout.overlays.map((item) => (
          <div
            key={item.id}
            className="viewport-grid__drawer"
            style={{
              top: bounds.bodyTop,
              height: bounds.bottomBudget,
              width: Math.max(0, Math.min(288, bounds.workbenchWidth, bounds.width - 48)),
              [item.area === "right" ? "right" : "left"]: 0,
            }}
          >
            <ItemHost item={item} registration={items.get(item.id)} cap={bounds.bottomBudget} />
          </div>
        ))}
      </div>
    </>
  )
}

function centerMinimum(lanes: ViewportGridLane[], bounds: Bounds) {
  if (bounds.width <= 0) return 0
  const occupied = lanes.reduce(
    (sum, lane) => sum + (lane.resizable ? lane.minWidth : lane.width) + bounds.gap,
    0,
  )
  return Math.max(0, Math.min(bounds.width < 640 ? 160 : 280, bounds.width - occupied))
}

function persistLaneWidths(
  lanes: ViewportGridLane[],
  sizes: Record<string, number>,
  available: number,
) {
  if (available <= 0) return
  for (const lane of lanes) {
    const percentage = sizes[lane.id]
    if (percentage === undefined) continue
    const pixels = (percentage * available) / 100
    for (const item of lane.items) {
      if (Math.abs(pixels - item.width) > 0.5) item.onWidthChange?.(pixels)
    }
  }
}

function GridResizers({
  root,
  layout,
  bounds,
  resize,
}: {
  root: RefObject<HTMLDivElement | null>
  layout: GridLayout
  bounds: Bounds
  resize: (id: string, width: number) => void
}) {
  const panelRefs = useRef(new Map<string, PanelImperativeHandle>())
  const lanes = [...layout.left, ...layout.right]
  // Recreate only the sizing proxy before its observer can react to parent-width changes.
  return (
    <ResizablePanelGroup
      key={`${lanes.map((lane) => lane.id).join(":")}:${bounds.width}`}
      style={{ width: bounds.width }}
      className="viewport-grid__resizers"
      onLayoutChanged={(sizes, { isUserInteraction }) => {
        if (isUserInteraction) {
          const available = (root.current?.clientWidth ?? 0) - lanes.length * bounds.gap
          persistLaneWidths(lanes, sizes, available)
        }
      }}
    >
      {layout.left.map((lane) => (
        <Fragment key={lane.id}>
          <LanePanel lane={lane} panelRefs={panelRefs} onResize={resize} />
          <LaneSeparator lane={lane} bounds={bounds} />
        </Fragment>
      ))}
      <ResizablePanel
        id="viewport-grid-center"
        minSize={centerMinimum(lanes, bounds)}
        aria-hidden="true"
      />
      {layout.right.map((lane) => (
        <Fragment key={lane.id}>
          <LaneSeparator lane={lane} bounds={bounds} />
          <LanePanel lane={lane} panelRefs={panelRefs} onResize={resize} />
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )
}

export function ViewportGrid({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const parking = useRef<HTMLDivElement>(null)
  const { items, register, unregister } = useRegistry()
  const { bounds, heights, schedule } = useMeasurements(root, items)
  const layout = useMemo(
    () => layoutViewportGrid([...items.values()], bounds, heights),
    [items, bounds, heights],
  )
  const bottomCap = bottomContentHeight(layout.bottom, heights, bounds.bottomBudget, bounds.gap)
  const context = useMemo(
    () => ({ register, unregister, bottom: layout.bottom, items, bottomCap }),
    [register, unregister, layout.bottom, items, bottomCap],
  )
  const { setLaneElement, resize } = useLaneSizing(schedule)
  useLayoutEffect(() => {
    for (const item of items.values()) {
      if (item.visible !== false) continue
      item.host.hidden = true
      item.host.dataset.viewportArea =
        item.mobile && bounds.width > 0 && bounds.width < item.mobile.below ? "bottom" : item.area
      parking.current?.append(item.host)
    }
    schedule.current()
  }, [items, layout, schedule])
  return (
    <Context.Provider value={context}>
      <div ref={root} className="viewport-grid">
        {children}
        <div ref={parking} hidden />
        <div className="viewport-grid__gap-measure" data-viewport-gap aria-hidden="true" />
        <GridSlots layout={layout} bounds={bounds} setLaneElement={setLaneElement} />
        <GridResizers root={root} layout={layout} bounds={bounds} resize={resize} />
      </div>
    </Context.Provider>
  )
}
