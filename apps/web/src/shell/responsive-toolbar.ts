import { useLayoutEffect, useRef, useState } from "react"

type ToolbarFitGroup = Readonly<{ id: string; commands: readonly string[] }>
type FitSizes = Readonly<{
  available: number
  leading: number
  icon: number
  gap: number
  separator: number
  menus: ReadonlyMap<string, number>
}>
type ToolbarFit = Readonly<{ compact: boolean; inline: readonly string[] }>
const initialFit: ToolbarFit = { compact: false, inline: [] }

function groupWidth(group: ToolbarFitGroup, selected: ReadonlySet<string>, sizes: FitSizes) {
  const count = group.commands.filter((id) => selected.has(id)).length
  const menu = count < group.commands.length
  const items = count + Number(menu)
  return (
    count * sizes.icon +
    (menu ? (sizes.menus.get(group.id) ?? 0) : 0) +
    Math.max(0, items - 1) * sizes.gap
  )
}
function rowWidth(
  groups: readonly ToolbarFitGroup[],
  selected: ReadonlySet<string>,
  sizes: FitSizes,
) {
  return (
    sizes.leading +
    groups.reduce(
      (width, group) =>
        width + groupWidth(group, selected, sizes) + sizes.separator + sizes.gap * 2,
      0,
    )
  )
}

export function fitToolbar(
  groups: readonly ToolbarFitGroup[],
  priority: readonly string[],
  sizes: FitSizes,
): ToolbarFit {
  const selected = new Set<string>()
  const candidates = priority.filter((id) => groups.some((group) => group.commands.includes(id)))
  for (const id of candidates) {
    if (groups.some((group) => group.commands.length === 1 && group.commands[0] === id))
      selected.add(id)
  }
  if (rowWidth(groups, selected, sizes) > sizes.available) return { compact: true, inline: [] }
  for (const id of candidates) {
    selected.add(id)
    if (rowWidth(groups, selected, sizes) > sizes.available) selected.delete(id)
  }
  return { compact: false, inline: [...selected] }
}

function measureToolbar(container: HTMLElement, probe: HTMLElement): FitSizes | null {
  const width = (selector: string) =>
    probe.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? 0
  const available = container.getBoundingClientRect().width
  const icon = width("[data-fit-icon]")
  if (available <= 0 || icon <= 0) return null
  const menus = new Map(
    [...probe.querySelectorAll<HTMLElement>("[data-fit-menu]")].map((element) => [
      element.dataset.fitMenu ?? "",
      element.getBoundingClientRect().width,
    ]),
  )
  return {
    available,
    icon,
    leading: width("[data-fit-leading]"),
    separator: width("[data-fit-separator]"),
    gap: Number.parseFloat(getComputedStyle(probe).columnGap) || 0,
    menus,
  }
}
function sameFit(first: ToolbarFit, second: ToolbarFit) {
  return first.compact === second.compact && first.inline.join("\0") === second.inline.join("\0")
}

export function useResponsiveToolbar(
  groups: readonly ToolbarFitGroup[],
  priority: readonly string[],
) {
  const container = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const inputs = useRef({ groups, priority })
  const current = useRef(initialFit)
  const openMenu = useRef(false)
  const deferred = useRef<ToolbarFit | null>(null)
  const deferredFrame = useRef<number | null>(null)
  const restore = useRef<{ element: HTMLElement; group: string | undefined } | null>(null)
  const [fit, setFit] = useState(initialFit)
  const signature = JSON.stringify({ groups, priority })
  useLayoutEffect(() => {
    inputs.current = { groups, priority }
  }, [groups, priority])
  const apply = (next: ToolbarFit) => {
    if (sameFit(current.current, next)) return
    const element = document.activeElement
    if (element instanceof HTMLElement && container.current?.contains(element)) {
      restore.current = {
        element,
        group: element.closest<HTMLElement>("[data-model-group]")?.dataset.modelGroup,
      }
    }
    current.current = next
    setFit(next)
  }
  useLayoutEffect(() => {
    const target = restore.current
    restore.current = null
    if (!target || target.element.isConnected) return
    const root = container.current
    const group = [...(root?.querySelectorAll<HTMLElement>("[data-model-group]") ?? [])].find(
      (element) => element.dataset.modelGroup === target.group,
    )
    const fallback = fit.compact
      ? root?.querySelector<HTMLButtonElement>("[data-toolbar-menu]")
      : group?.querySelector<HTMLButtonElement>("[data-toolbar-menu],button")
    const targetButton = fallback ?? root?.querySelector<HTMLButtonElement>("button")
    targetButton?.focus()
  }, [fit])
  useLayoutEffect(() => {
    const root = container.current
    const rail = probe.current
    if (!root || !rail) return
    let frame: number | null = null
    let disposed = false
    const measure = () => {
      frame = null
      if (disposed) return
      const sizes = measureToolbar(root, rail)
      if (!sizes) return
      const next = fitToolbar(inputs.current.groups, inputs.current.priority, sizes)
      if (openMenu.current) deferred.current = next
      else {
        deferred.current = null
        apply(next)
      }
    }
    const schedule = () => {
      if (!disposed && frame === null) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(root)
    observer.observe(rail)
    measure()
    return () => {
      disposed = true
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
      if (deferredFrame.current !== null) cancelAnimationFrame(deferredFrame.current)
    }
  }, [signature])
  return {
    container,
    probe,
    fit,
    onMenuOpenChange(open: boolean) {
      openMenu.current = open
      if (open || !deferred.current) return
      if (deferredFrame.current !== null) cancelAnimationFrame(deferredFrame.current)
      deferredFrame.current = requestAnimationFrame(() => {
        deferredFrame.current = null
        if (openMenu.current) return
        const next = deferred.current
        deferred.current = null
        if (next) apply(next)
      })
    },
  }
}
