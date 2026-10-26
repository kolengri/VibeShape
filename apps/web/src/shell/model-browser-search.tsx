import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { SearchIcon, X } from "@vibeshape/ui/components/icons"
import { Input } from "@vibeshape/ui/components/input"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { modelBrowserSelectedRow } from "./model-browser-styles"

type SearchType = "part" | "body" | "sketch" | "plane" | "operation"
const searchGroups = ["parts", "planes", "history"] as const
const ModelBrowserTreeVisibility = createContext(true)

export function useModelBrowserTreeVisible() {
  return useContext(ModelBrowserTreeVisibility)
}

export type ModelBrowserSearchEntry = Readonly<{
  key: string
  type: SearchType
  label: string
  path: string
  searchText: string
  unavailable: boolean
  onActivate: () => void
  onPreselect?: (active: boolean) => void
}>

function modelSearchGroup(entry: ModelBrowserSearchEntry) {
  if (entry.type === "part" || entry.type === "body") return "parts"
  return entry.type === "plane" ? "planes" : "history"
}

function modelSearchMatches(
  entry: ModelBrowserSearchEntry,
  terms: readonly string[],
  typeLabel: string,
) {
  const text = `${entry.label} ${entry.path} ${typeLabel} ${entry.searchText}`.toLocaleLowerCase()
  return terms.every((term) => text.includes(term))
}

function modelSearchTabStop(
  entries: readonly ModelBrowserSearchEntry[],
  focusedKey: string | null,
) {
  return (
    entries.find((entry) => !entry.unavailable && entry.key === focusedKey) ??
    entries.find((entry) => !entry.unavailable)
  )
}

export function ModelBrowserSearch({
  children,
  entries,
  selectedKeys,
  onSelectionClick,
}: {
  children: ReactNode
  entries: readonly ModelBrowserSearchEntry[]
  selectedKeys: ReadonlySet<string>
  onSelectionClick: (event: MouseEvent<HTMLElement>) => void
}) {
  const t = useTranslations("app.shell.modelTree.search")
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const preview = useRef<ModelBrowserSearchEntry | null>(null)
  const [query, setQuery] = useState("")
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const active = query.length > 0
  const matches = entries
    .filter((entry) => modelSearchMatches(entry, terms, t(`types.${entry.type}`)))
    .sort(
      (a, b) =>
        searchGroups.indexOf(modelSearchGroup(a)) - searchGroups.indexOf(modelSearchGroup(b)),
    )
  const visibleKeys = new Set(matches.map((entry) => entry.key))
  const hiddenSelection = [...selectedKeys].filter((key) => !visibleKeys.has(key)).length
  const tabStop = modelSearchTabStop(matches, focusedKey)
  const clearPreview = () => {
    preview.current?.onPreselect?.(false)
    preview.current = null
  }
  const preselect = (entry: ModelBrowserSearchEntry, active: boolean) => {
    clearPreview()
    if (!active || entry.unavailable) return
    preview.current = entry
    entry.onPreselect?.(true)
  }
  useEffect(
    () => () => {
      preview.current?.onPreselect?.(false)
    },
    [],
  )
  const clear = () => {
    clearPreview()
    setQuery("")
    setFocusedKey(null)
    input.current?.focus()
  }
  const resultButtons = () => [
    ...(results.current?.querySelectorAll<HTMLButtonElement>(
      "[data-model-search-result]:not(:disabled)",
    ) ?? []),
  ]
  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !active) return false
    event.preventDefault()
    event.stopPropagation()
    clear()
    return true
  }

  return (
    <>
      <div className="mb-2">
        <div className="relative flex min-w-0 items-center">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-2 size-4 text-muted-foreground"
          />
          <Input
            ref={input}
            type="search"
            aria-label={t("label")}
            aria-controls={active ? `${id}-results` : undefined}
            placeholder={t("placeholder")}
            className="h-8 pl-7 pr-8 text-xs"
            value={query}
            onChange={(event) => {
              clearPreview()
              setQuery(event.target.value)
            }}
            onKeyDown={(event) => {
              if (handleEscape(event)) return
              if (!active || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return
              event.preventDefault()
              const buttons = resultButtons()
              ;(event.key === "ArrowDown" ? buttons[0] : buttons.at(-1))?.focus()
            }}
          />
          {active && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="absolute right-1"
              aria-label={t("clear")}
              onClick={clear}
              onKeyDown={handleEscape}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {active && (
        <div>
          <ModelSearchStatus count={matches.length} hiddenSelection={hiddenSelection} />
          <div
            id={`${id}-results`}
            ref={results}
            role="tree"
            aria-label={t("results")}
            aria-multiselectable="true"
            onClickCapture={onSelectionClick}
            onKeyDown={(event) => {
              if (handleEscape(event)) return
              const buttons = resultButtons()
              const index = buttons.indexOf(event.target as HTMLButtonElement)
              if (index < 0) return
              const target = modelSearchFocusTarget(event.key, buttons, index, input.current)
              if (!target) return
              event.preventDefault()
              event.stopPropagation()
              target.focus()
            }}
          >
            <ModelSearchGroups
              matches={matches}
              selectedKeys={selectedKeys}
              tabStop={tabStop}
              id={id}
              onFocusKey={setFocusedKey}
              onPreselect={preselect}
            />
          </div>
        </div>
      )}
      <ModelBrowserTreeVisibility value={!active}>
        <div hidden={active}>{children}</div>
      </ModelBrowserTreeVisibility>
    </>
  )
}

function ModelSearchStatus({ count, hiddenSelection }: { count: number; hiddenSelection: number }) {
  const t = useTranslations("app.shell.modelTree.search")
  return (
    <>
      <p role="status" className="px-2 pb-1 text-xs text-muted-foreground">
        {t("count", { count })}
      </p>
      {hiddenSelection > 0 && (
        <p role="status" className="px-2 pb-2 text-xs text-muted-foreground">
          {t("hiddenSelection", { count: hiddenSelection })}
        </p>
      )}
    </>
  )
}

function modelSearchFocusTarget(
  key: string,
  buttons: readonly HTMLButtonElement[],
  index: number,
  input: HTMLInputElement | null,
): HTMLElement | null | undefined {
  switch (key) {
    case "ArrowDown":
      return buttons[Math.min(index + 1, buttons.length - 1)]
    case "ArrowUp":
      return index === 0 ? input : buttons[index - 1]
    case "Home":
      return buttons[0]
    case "End":
      return buttons.at(-1)
    default:
      return null
  }
}

type ModelSearchGroupsProps = {
  matches: readonly ModelBrowserSearchEntry[]
  selectedKeys: ReadonlySet<string>
  tabStop: ModelBrowserSearchEntry | undefined
  id: string
  onFocusKey: (key: string) => void
  onPreselect: (entry: ModelBrowserSearchEntry, active: boolean) => void
}

function ModelSearchGroups(props: ModelSearchGroupsProps) {
  const t = useTranslations("app.shell.modelTree.search")
  const treeT = useTranslations("app.shell.modelTree")
  return searchGroups.map((group) => {
    const grouped = props.matches.filter((entry) => modelSearchGroup(entry) === group)
    if (!grouped.length) return null
    const label = group === "parts" ? t("types.part") : treeT(`items.${group}`)
    return (
      <fieldset key={group} aria-label={label}>
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground" aria-hidden="true">
          {label}
        </p>
        {grouped.map((entry) => (
          <ModelSearchResult key={entry.key} {...props} entry={entry} />
        ))}
      </fieldset>
    )
  })
}

function ModelSearchResult({
  entry,
  selectedKeys,
  tabStop,
  id,
  onFocusKey,
  onPreselect,
}: Omit<ModelSearchGroupsProps, "matches"> & { entry: ModelBrowserSearchEntry }) {
  const t = useTranslations("app.shell.modelTree.search")
  const key = entry.key
  const selected = selectedKeys.has(key)
  const descriptionId = `${id}-${encodeURIComponent(key)}`
  return (
    <Button
      type="button"
      role="treeitem"
      variant="ghost"
      size="sm"
      className={cn(
        "h-auto w-full min-w-0 flex-col items-start gap-0.5 whitespace-normal px-2 py-1.5 text-left",
        selected && modelBrowserSelectedRow,
      )}
      aria-label={entry.label}
      aria-describedby={descriptionId}
      aria-selected={selected}
      disabled={entry.unavailable}
      tabIndex={tabStop === entry ? 0 : -1}
      data-model-search-result
      data-model-tree-selection-key={key}
      onPointerEnter={() => onPreselect(entry, true)}
      onPointerLeave={() => onPreselect(entry, false)}
      onPointerCancel={() => onPreselect(entry, false)}
      onFocus={() => {
        onFocusKey(key)
        onPreselect(entry, true)
      }}
      onBlur={() => onPreselect(entry, false)}
      onClick={(event) => {
        if (!event.defaultPrevented) entry.onActivate()
      }}
    >
      <span className="w-full break-words">{entry.label}</span>
      <span
        id={descriptionId}
        className="w-full break-words text-xs font-normal text-muted-foreground"
      >
        {entry.path}
        {entry.unavailable && <span className="block">{t("unavailable")}</span>}
        {selected && <span className="sr-only">{t("selection")}</span>}
      </span>
    </Button>
  )
}
