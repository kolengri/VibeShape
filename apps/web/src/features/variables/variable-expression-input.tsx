import { useTranslations } from "@vibeshape/i18n"
import { Input } from "@vibeshape/ui/components/input"
import { Popover, PopoverAnchor, PopoverContent } from "@vibeshape/ui/components/popover"
import { isFunction } from "is-what"
import {
  type ChangeEvent,
  type ComponentProps,
  type Dispatch,
  type KeyboardEvent,
  type Ref,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"

const MAX_VISIBLE_SUGGESTIONS = 8
const variableTokenPattern = /#([A-Za-z_][A-Za-z0-9_]*)?$/
const variableNameTailPattern = /^[A-Za-z0-9_]*/

export type VariableExpressionSuggestion = Readonly<{
  description?: string | undefined
  id?: string | undefined
  name: string
}>

export function variableExpressionSuggestions(
  variables: readonly Readonly<{ expression: string; id?: string | undefined; name: string }>[],
) {
  return variables.map(({ expression, id, name }) => ({ description: expression, id, name }))
}

type VariableToken = Readonly<{
  end: number
  query: string
  start: number
}>

type SuggestionState = Readonly<{
  activeIndex: number
  anchorWidth: number
  suggestions: readonly VariableExpressionSuggestion[]
  token: VariableToken
}>

type SetSuggestionState = Dispatch<SetStateAction<SuggestionState | null>>
type SelectSuggestion = (suggestion: VariableExpressionSuggestion, restoreFocus?: boolean) => void
type SuggestionKeyAction = "close" | "complete" | "complete-and-advance" | "next" | "previous"

const suggestionKeyActions = new Map<string, SuggestionKeyAction>([
  ["ArrowDown", "next"],
  ["ArrowUp", "previous"],
  ["Enter", "complete"],
  ["Tab", "complete-and-advance"],
  ["Escape", "close"],
])

export type VariableExpressionInputProps = Omit<ComponentProps<typeof Input>, "onChange"> &
  Readonly<{
    excludedSuggestionId?: string | undefined
    onChange?: ((event: ChangeEvent<HTMLInputElement>) => void) | undefined
    onValueChange?: ((value: string) => void) | undefined
    suggestions: readonly VariableExpressionSuggestion[]
  }>

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (isFunction(ref)) {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

function variableTokenAtCaret(input: HTMLInputElement): VariableToken | null {
  const selectionStart = input.selectionStart
  const selectionEnd = input.selectionEnd
  if (selectionStart === null || selectionStart !== selectionEnd) return null
  const prefix = input.value.slice(0, selectionStart)
  const match = variableTokenPattern.exec(prefix)
  if (!match) return null
  const query = match[1] ?? ""
  const tail = variableNameTailPattern.exec(input.value.slice(selectionStart))?.[0] ?? ""
  return {
    start: selectionStart - match[0].length,
    end: selectionStart + tail.length,
    query,
  }
}

function uniqueSuggestions(suggestions: readonly VariableExpressionSuggestion[]) {
  const names = new Set<string>()
  return suggestions.filter(({ name }) => {
    if (!name || names.has(name)) return false
    names.add(name)
    return true
  })
}

function matchingSuggestions(suggestions: readonly VariableExpressionSuggestion[], query: string) {
  const normalizedQuery = query.toLowerCase()
  return suggestions
    .filter(({ name }) => name !== query && name.toLowerCase().startsWith(normalizedQuery))
    .slice(0, MAX_VISIBLE_SUGGESTIONS)
}

function moveActiveSuggestion(setState: SetSuggestionState, direction: -1 | 1) {
  setState((current) =>
    current
      ? {
          ...current,
          activeIndex:
            (current.activeIndex + direction + current.suggestions.length) %
            current.suggestions.length,
        }
      : null,
  )
}

function selectActiveSuggestion(
  state: SuggestionState,
  selectSuggestion: SelectSuggestion,
  restoreFocus = true,
) {
  const suggestion = state.suggestions[state.activeIndex]
  if (suggestion) selectSuggestion(suggestion, restoreFocus)
}

function handleSuggestionKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  state: SuggestionState,
  setState: SetSuggestionState,
  selectSuggestion: SelectSuggestion,
) {
  const action = suggestionKeyActions.get(event.key)
  switch (action) {
    case "next":
      event.preventDefault()
      moveActiveSuggestion(setState, 1)
      return
    case "previous":
      event.preventDefault()
      moveActiveSuggestion(setState, -1)
      return
    case "complete":
      event.preventDefault()
      selectActiveSuggestion(state, selectSuggestion)
      return
    case "complete-and-advance":
      selectActiveSuggestion(state, selectSuggestion, false)
      return
    case "close":
      event.preventDefault()
      event.stopPropagation()
      setState(null)
  }
}

function VariableSuggestionPopup({
  inputRef,
  label,
  listboxId,
  selectSuggestion,
  setState,
  state,
}: Readonly<{
  inputRef: RefObject<HTMLInputElement | null>
  label: string
  listboxId: string
  selectSuggestion: SelectSuggestion
  setState: SetSuggestionState
  state: SuggestionState
}>) {
  return (
    <PopoverContent
      align="start"
      sideOffset={4}
      collisionPadding={8}
      className="max-h-52 overflow-y-auto p-1"
      style={{ width: state.anchorWidth }}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setState(null)
      }}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onInteractOutside={(event) => {
        if (event.target === inputRef.current) event.preventDefault()
      }}
    >
      <div id={listboxId} role="listbox" aria-label={label}>
        {state.suggestions.map((suggestion, index) => (
          <div
            id={`${listboxId}-option-${index}`}
            key={suggestion.id ?? suggestion.name}
            role="option"
            tabIndex={-1}
            aria-selected={index === state.activeIndex}
            className="grid cursor-default gap-0.5 rounded-sm px-2 py-1.5 outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            data-selected={index === state.activeIndex || undefined}
            onPointerEnter={() =>
              setState((current) => (current ? { ...current, activeIndex: index } : null))
            }
            onPointerDown={(event) => {
              event.preventDefault()
              selectSuggestion(suggestion)
            }}
          >
            <span className="font-mono text-sm">#{suggestion.name}</span>
            {suggestion.description ? (
              <span className="truncate text-xs text-muted-foreground">
                {suggestion.description}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </PopoverContent>
  )
}

function useVariableSuggestionState({
  excludedSuggestionId,
  onValueChange,
  suggestions,
}: Pick<VariableExpressionInputProps, "excludedSuggestionId" | "onValueChange" | "suggestions">) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const normalizedSuggestions = useMemo(
    () => uniqueSuggestions(suggestions.filter(({ id }) => id !== excludedSuggestionId)),
    [excludedSuggestionId, suggestions],
  )
  const [state, setState] = useState<SuggestionState | null>(null)

  const refresh = useCallback(
    (input: HTMLInputElement) => {
      const token = variableTokenAtCaret(input)
      if (!token) {
        setState(null)
        return
      }
      const matches = matchingSuggestions(normalizedSuggestions, token.query)
      setState(
        matches.length > 0
          ? {
              activeIndex: 0,
              anchorWidth: input.getBoundingClientRect().width,
              suggestions: matches,
              token,
            }
          : null,
      )
    },
    [normalizedSuggestions],
  )

  useEffect(() => {
    const input = inputRef.current
    if (input && document.activeElement === input) refresh(input)
  }, [refresh])

  const selectSuggestion = useCallback<SelectSuggestion>(
    (suggestion, restoreFocus = true) => {
      const input = inputRef.current
      if (!input || !state) return
      const nextValue = `${input.value.slice(0, state.token.start)}#${suggestion.name}${input.value.slice(state.token.end)}`
      const nextCaret = state.token.start + suggestion.name.length + 1
      input.value = nextValue
      input.setSelectionRange(nextCaret, nextCaret)
      onValueChange?.(nextValue)
      setState(null)
      if (restoreFocus) {
        requestAnimationFrame(() => {
          input.focus()
          input.setSelectionRange(nextCaret, nextCaret)
        })
      }
    },
    [onValueChange, state],
  )

  return {
    activeOptionId: state ? `${listboxId}-option-${state.activeIndex}` : undefined,
    inputRef,
    listboxId,
    refresh,
    selectSuggestion,
    setState,
    state,
  } as const
}

type VariableExpressionInputBindings = Pick<
  ComponentProps<typeof Input>,
  "onBlur" | "onChange" | "onClick" | "onFocus" | "onKeyDown" | "onSelect" | "ref"
>

function variableExpressionInputBindings({
  inputRef,
  onBlur,
  onChange,
  onClick,
  onFocus,
  onKeyDown,
  onSelect,
  onValueChange,
  refresh,
  ref,
  selectSuggestion,
  setState,
  state,
}: Readonly<{
  inputRef: RefObject<HTMLInputElement | null>
  onBlur: VariableExpressionInputProps["onBlur"]
  onChange: VariableExpressionInputProps["onChange"]
  onClick: VariableExpressionInputProps["onClick"]
  onFocus: VariableExpressionInputProps["onFocus"]
  onKeyDown: VariableExpressionInputProps["onKeyDown"]
  onSelect: VariableExpressionInputProps["onSelect"]
  onValueChange: VariableExpressionInputProps["onValueChange"]
  refresh: (input: HTMLInputElement) => void
  ref: Ref<HTMLInputElement> | undefined
  selectSuggestion: SelectSuggestion
  setState: SetSuggestionState
  state: SuggestionState | null
}>): VariableExpressionInputBindings {
  return {
    ref: (input) => {
      inputRef.current = input
      assignRef(ref, input)
    },
    onBlur: (event) => {
      onBlur?.(event)
      setState(null)
    },
    onChange: (event) => {
      onChange?.(event)
      onValueChange?.(event.currentTarget.value)
      refresh(event.currentTarget)
    },
    onClick: (event) => {
      onClick?.(event)
      if (!event.defaultPrevented) refresh(event.currentTarget)
    },
    onFocus: (event) => {
      onFocus?.(event)
      if (!event.defaultPrevented) refresh(event.currentTarget)
    },
    onKeyDown: (event) => {
      onKeyDown?.(event)
      if (!event.defaultPrevented && state) {
        handleSuggestionKeyDown(event, state, setState, selectSuggestion)
      }
    },
    onSelect: (event) => {
      onSelect?.(event)
      if (!event.defaultPrevented) refresh(event.currentTarget)
    },
  }
}

export function VariableExpressionInput({
  excludedSuggestionId,
  onBlur,
  onChange,
  onClick,
  onFocus,
  onKeyDown,
  onSelect,
  onValueChange,
  ref,
  suggestions,
  ...inputProps
}: VariableExpressionInputProps) {
  const t = useTranslations("app.variableSuggestions")
  const { activeOptionId, inputRef, listboxId, refresh, selectSuggestion, setState, state } =
    useVariableSuggestionState({ excludedSuggestionId, onValueChange, suggestions })
  const inputBindings = variableExpressionInputBindings({
    inputRef,
    onBlur,
    onChange,
    onClick,
    onFocus,
    onKeyDown,
    onSelect,
    onValueChange,
    refresh,
    ref,
    selectSuggestion,
    setState,
    state,
  })

  return (
    <Popover open={state !== null} onOpenChange={(open) => !open && setState(null)}>
      <PopoverAnchor asChild>
        <Input
          {...inputProps}
          {...inputBindings}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={state ? listboxId : undefined}
          aria-expanded={state !== null}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          spellCheck={false}
        />
      </PopoverAnchor>
      {state ? (
        <VariableSuggestionPopup
          inputRef={inputRef}
          label={t("label")}
          listboxId={listboxId}
          selectSuggestion={selectSuggestion}
          setState={setState}
          state={state}
        />
      ) : null}
    </Popover>
  )
}
