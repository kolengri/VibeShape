import * as React from "react"

import { Button } from "#components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#components/command"
import { Field, FieldDescription, FieldError, FieldLabel } from "#components/field"
import { ChevronDown, IndicatorCheckIcon } from "#components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "#components/popover"
import { cn } from "#lib/cn"

export type SearchableSelectOption = Readonly<{
  value: string
  label: string
  icon?: React.ReactNode
  description?: string | undefined
  keywords?: readonly string[]
  group?: string | undefined
  disabled?: boolean | undefined
}>

type SearchableSelectValueProps = Readonly<{
  options: readonly SearchableSelectOption[]
  value?: string | undefined
  defaultValue?: string | undefined
  onValueChange?: ((value: string) => void) | undefined
  placeholder: string
  searchPlaceholder: string
  searchLabel?: string | undefined
  emptyMessage: string
  id?: string | undefined
  name?: string | undefined
  required?: boolean | undefined
  disabled?: boolean | undefined
  onBlur?: React.FocusEventHandler<HTMLButtonElement> | undefined
  ref?: React.Ref<HTMLButtonElement> | undefined
}>

export type SearchableSelectControlProps = SearchableSelectValueProps &
  Readonly<{
    "aria-label": string
    "aria-labelledby"?: string | undefined
    "aria-describedby"?: string | undefined
    "aria-invalid"?: React.AriaAttributes["aria-invalid"]
    className?: string | undefined
    iconOnly?: boolean | undefined
    onOpenChange?: ((open: boolean) => void) | undefined
  }>

function searchableText(option: SearchableSelectOption) {
  return [option.label, option.description ?? "", option.group ?? "", ...(option.keywords ?? [])]
}

function matchesSearch(text: readonly string[], query: string) {
  const search = query.trim().toLowerCase()
  return text.some((part) => part.toLowerCase().includes(search))
}

function isControlVisible(element: HTMLElement) {
  if (element.closest('[hidden], [inert], [aria-hidden="true"], [data-radix-focus-guard]'))
    return false
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    if (style.display === "none" || style.visibility === "hidden") return false
  }
  return true
}

function isRadioTabStop(element: HTMLElement) {
  if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name)
    return true
  const peers = Array.from(element.ownerDocument.getElementsByName(element.name)).filter(
    (peer) =>
      peer instanceof HTMLInputElement &&
      peer.type === "radio" &&
      peer.form === element.form &&
      !peer.disabled,
  )
  return (
    element === (peers.find((peer) => peer instanceof HTMLInputElement && peer.checked) ?? peers[0])
  )
}

function focusAdjacentControl(trigger: HTMLButtonElement | null, direction: -1 | 1) {
  if (!trigger) return
  const controls = Array.from(
    trigger.ownerDocument.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
    ),
  )
    .filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled, input[type="hidden"]') &&
        isControlVisible(element) &&
        isRadioTabStop(element),
    )
    .sort((first, second) => {
      const firstOrder = first.tabIndex || Number.POSITIVE_INFINITY
      const secondOrder = second.tabIndex || Number.POSITIVE_INFINITY
      return firstOrder === secondOrder ? 0 : firstOrder - secondOrder
    })
  const index = controls.indexOf(trigger)
  const nextControl = controls[index + direction] ?? trigger
  nextControl.focus()
}

function useSelectValue({
  value,
  defaultValue = "",
  onValueChange,
}: Pick<SearchableSelectValueProps, "value" | "defaultValue" | "onValueChange">) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const nativeRef = React.useRef<HTMLSelectElement>(null)
  React.useEffect(() => {
    const form = nativeRef.current?.form
    if (!form) return
    const reset = (event: Event) => {
      queueMicrotask(() => {
        if (event.defaultPrevented || !nativeRef.current) return
        if (value === undefined) setUncontrolledValue(defaultValue)
        nativeRef.current.value = value ?? defaultValue
      })
    }
    form.addEventListener("reset", reset)
    return () => form.removeEventListener("reset", reset)
  }, [defaultValue, value])
  return {
    nativeRef,
    selectedValue: value ?? uncontrolledValue,
    select: (nextValue: string) => {
      if (value === undefined) setUncontrolledValue(nextValue)
      onValueChange?.(nextValue)
    },
  }
}

function groupOptions(options: readonly SearchableSelectOption[]) {
  const groups = new Map<string | undefined, SearchableSelectOption[]>()
  for (const option of options) {
    const name = option.group || undefined
    const group = groups.get(name) ?? []
    group.push(option)
    groups.set(name, group)
  }
  return groups
}

function SearchableSelectItem({
  option,
  current,
  onSelect,
}: Readonly<{
  option: SearchableSelectOption
  current: boolean
  onSelect: (option: SearchableSelectOption) => void
}>) {
  const descriptionId = React.useId()
  return (
    <CommandItem
      value={JSON.stringify(option.value)}
      keywords={searchableText(option)}
      disabled={Boolean(option.disabled)}
      aria-label={option.label}
      aria-describedby={option.description ? descriptionId : undefined}
      aria-current={current ? "true" : undefined}
      data-current={current || undefined}
      onSelect={() => onSelect(option)}
    >
      {option.icon ? (
        <span aria-hidden="true" className="shrink-0">
          {option.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal">
        <span className="block">{option.label}</span>
        {option.description ? (
          <span id={descriptionId} className="block text-xs text-muted-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
      <IndicatorCheckIcon aria-hidden="true" className={cn("size-4", !current && "invisible")} />
    </CommandItem>
  )
}

type NativeSelectProps = Pick<
  SearchableSelectValueProps,
  "options" | "placeholder" | "name" | "required" | "disabled" | "onValueChange"
> & {
  ref: React.Ref<HTMLSelectElement>
  value: string
  onInvalid: React.FormEventHandler<HTMLSelectElement>
}

function SearchableSelectNative({
  options,
  placeholder,
  name,
  required,
  disabled,
  onValueChange,
  ref,
  value,
  onInvalid,
}: NativeSelectProps) {
  const retainMissingValue = value !== "" && !options.some((option) => option.value === value)
  return (
    <select
      ref={ref}
      data-slot="searchable-select-native"
      aria-hidden="true"
      tabIndex={-1}
      className="sr-only"
      name={name}
      required={required}
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
      onInvalid={onInvalid}
    >
      {!options.some((option) => option.value === "") ? (
        <option value="">{placeholder}</option>
      ) : null}
      {retainMissingValue ? <option value={value}>{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function hasFieldContent(content: React.ReactNode) {
  return content !== undefined && content !== null && content !== ""
}

function fieldContent(id: string, description: React.ReactNode, error: React.ReactNode) {
  const hasDescription = hasFieldContent(description)
  const hasError = hasFieldContent(error)
  const describedBy = [hasDescription && `${id}-description`, hasError && `${id}-error`]
    .filter(Boolean)
    .join(" ")
  return { hasDescription, hasError, describedBy }
}

function controlLabel(label: React.ReactNode, ariaLabel: string | undefined, placeholder: string) {
  return ariaLabel ?? (typeof label === "string" ? label : placeholder)
}

type SearchableSelectMenuProps = Pick<
  SearchableSelectValueProps,
  "options" | "searchPlaceholder" | "emptyMessage"
> & {
  label: string
  searchLabel: string
  selectedValue: string
  query: string
  onQueryChange: (query: string) => void
  inputRef: React.Ref<HTMLInputElement>
  listRef: React.Ref<HTMLDivElement>
  onTab: (direction: -1 | 1) => void
  onSelect: (option: SearchableSelectOption) => void
}

function SearchableSelectMenu({
  options,
  label,
  searchLabel,
  searchPlaceholder,
  emptyMessage,
  selectedValue,
  query,
  onQueryChange,
  inputRef,
  listRef,
  onTab,
  onSelect,
}: SearchableSelectMenuProps) {
  const initialOption = options.find((option) => option.value === selectedValue)
  const groups = groupOptions(options)
  return (
    <Command
      label={searchLabel}
      defaultValue={initialOption ? JSON.stringify(initialOption.value) : ""}
      filter={(_value, search, keywords) => (matchesSearch(keywords ?? [], search) ? 1 : 0)}
    >
      <CommandInput
        ref={inputRef}
        aria-label={searchLabel}
        placeholder={searchPlaceholder}
        value={query}
        onValueChange={onQueryChange}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            // The portaled search input must exit in the field's surrounding tab order.
            event.preventDefault()
            onTab(event.shiftKey ? -1 : 1)
          }
        }}
      />
      <CommandList
        ref={listRef}
        label={label}
        className="max-h-[min(20rem,calc(var(--radix-popover-content-available-height)-3rem))]"
      >
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        {Array.from(groups, ([group, groupedOptions]) => (
          <CommandGroup key={group ?? ""} heading={group}>
            {groupedOptions.map((option) => (
              <SearchableSelectItem
                key={option.value}
                option={option}
                current={option.value === selectedValue}
                onSelect={onSelect}
              />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}

type SearchableSelectTriggerProps = Omit<React.ComponentProps<typeof Button>, "children"> & {
  targetRef: React.RefObject<HTMLButtonElement | null>
  selectedLabel: string
  selectedIcon: React.ReactNode
  iconOnly: boolean | undefined
}

function SearchableSelectTrigger({
  targetRef,
  ref,
  selectedLabel,
  selectedIcon,
  iconOnly,
  className,
  ...props
}: SearchableSelectTriggerProps) {
  return (
    <Button
      {...props}
      ref={(element) => {
        targetRef.current = element
        if (typeof ref === "function") return ref(element)
        if (ref) ref.current = element
      }}
      className={cn(
        "h-fit min-h-8 w-full min-w-0 justify-between gap-2 px-3 py-1.5 text-left font-normal whitespace-normal",
        "aria-invalid:border-destructive",
        iconOnly && "w-9 shrink-0 justify-center px-0",
        className,
      )}
    >
      <span className={cn("flex min-w-0 flex-1 items-center gap-2", iconOnly && "sr-only")}>
        {selectedIcon ? (
          <span aria-hidden="true" className="shrink-0">
            {selectedIcon}
          </span>
        ) : null}
        <span className="min-w-0 wrap-anywhere">{selectedLabel}</span>
      </span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Button>
  )
}

function useSelectMenu(
  disabled: boolean | undefined,
  onOpenChange: SearchableSelectControlProps["onOpenChange"],
  onValueChange: (value: string) => void,
) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  React.useEffect(() => {
    if (disabled) {
      setOpen(false)
      setQuery("")
    }
  }, [disabled])
  const changeOpen = (nextOpen: boolean) => {
    if (disabled && nextOpen) return
    setQuery("")
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }
  const onSelect = (selected: SearchableSelectOption) => {
    if (disabled || selected.disabled || !matchesSearch(searchableText(selected), query)) return
    onValueChange(selected.value)
    changeOpen(false)
  }
  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      changeOpen(true)
    }
  }
  return { open: open && !disabled, query, setQuery, changeOpen, onSelect, onTriggerKeyDown }
}

function forwardCompositeBlur(
  event: React.FocusEvent<HTMLButtonElement> | null,
  trigger: HTMLButtonElement | null,
  relatedTarget: Element | null,
  onBlur: SearchableSelectControlProps["onBlur"],
) {
  if (!event || !trigger) return
  // Retain the public trigger event contract when focus leaves the portaled composite.
  onBlur?.({
    ...event,
    target: trigger,
    currentTarget: trigger,
    relatedTarget,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    isDefaultPrevented: () => event.isDefaultPrevented(),
    isPropagationStopped: () => event.isPropagationStopped(),
    persist: () => event.persist(),
  })
}

function useSelectFocus(
  changeOpen: (open: boolean) => void,
  onBlur: SearchableSelectControlProps["onBlur"],
) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const deferredBlur = React.useRef<React.FocusEvent<HTMLButtonElement> | null>(null)
  const outsideInteraction = React.useRef(false)
  const tabDirection = React.useRef<-1 | 1 | null>(null)
  const [listboxId, setListboxId] = React.useState<string | undefined>()
  const listRef = React.useCallback((element: HTMLDivElement | null) => {
    if (element) setListboxId(element.id)
  }, [])
  const isInside = (target: EventTarget | null) =>
    target instanceof Node &&
    Boolean(triggerRef.current?.contains(target) || contentRef.current?.contains(target))
  const onTriggerBlur = (event: React.FocusEvent<HTMLButtonElement>) => {
    if (isInside(event.relatedTarget)) deferredBlur.current = event
    else {
      deferredBlur.current = null
      onBlur?.(event)
    }
  }
  const onOpenAutoFocus = (event: Event) => {
    event.preventDefault()
    // Safari pointer activation can leave the trigger unfocused.
    triggerRef.current?.focus()
    searchRef.current?.focus()
  }
  const onInteractOutside: NonNullable<
    React.ComponentProps<typeof PopoverContent>["onInteractOutside"]
  > = (event) => {
    if (isInside(event.target)) event.preventDefault()
    else outsideInteraction.current = true
  }
  const onCloseAutoFocus = (event: Event) => {
    const leftByTab = tabDirection.current !== null
    if (tabDirection.current !== null) {
      event.preventDefault()
      focusAdjacentControl(triggerRef.current, tabDirection.current)
    }
    if (leftByTab || outsideInteraction.current) {
      forwardCompositeBlur(deferredBlur.current, triggerRef.current, document.activeElement, onBlur)
    }
    deferredBlur.current = null
    outsideInteraction.current = false
    tabDirection.current = null
  }
  const onInvalid = (event: React.InvalidEvent<HTMLSelectElement>) => {
    event.preventDefault()
    triggerRef.current?.focus()
  }
  const onTab = (direction: -1 | 1) => {
    tabDirection.current = direction
    changeOpen(false)
  }
  return {
    triggerRef,
    searchRef,
    contentRef,
    listboxId,
    listRef,
    onTriggerBlur,
    onOpenAutoFocus,
    onCloseAutoFocus,
    onInteractOutside,
    onInvalid,
    onTab,
  }
}

export function SearchableSelectControl(props: SearchableSelectControlProps) {
  const label = props["aria-label"]
  const searchLabel = props.searchLabel ?? props.searchPlaceholder
  const binding = useSelectValue(props)
  const menu = useSelectMenu(props.disabled, props.onOpenChange, binding.select)
  const focus = useSelectFocus(menu.changeOpen, props.onBlur)
  const selectedOption = props.options.find((option) => option.value === binding.selectedValue)

  return (
    <Popover open={menu.open} onOpenChange={menu.changeOpen}>
      <SearchableSelectNative
        ref={binding.nativeRef}
        options={props.options}
        placeholder={props.placeholder}
        value={binding.selectedValue}
        name={props.name}
        required={props.required}
        disabled={props.disabled}
        onValueChange={binding.select}
        onInvalid={focus.onInvalid}
      />
      <PopoverTrigger asChild>
        <SearchableSelectTrigger
          ref={props.ref}
          targetRef={focus.triggerRef}
          selectedLabel={selectedOption?.label ?? props.placeholder}
          selectedIcon={selectedOption?.icon}
          iconOnly={props.iconOnly}
          data-slot="searchable-select-trigger"
          id={props.id}
          type="button"
          role="combobox"
          variant="outline"
          aria-label={label}
          aria-labelledby={props["aria-labelledby"]}
          aria-haspopup="listbox"
          aria-expanded={menu.open}
          aria-controls={menu.open ? focus.listboxId : undefined}
          aria-required={props.required || undefined}
          aria-describedby={props["aria-describedby"]}
          aria-invalid={props["aria-invalid"]}
          disabled={props.disabled}
          onBlur={focus.onTriggerBlur}
          onKeyDown={menu.onTriggerKeyDown}
          className={props.className}
        />
      </PopoverTrigger>
      <PopoverContent
        ref={focus.contentRef}
        aria-label={label}
        align="start"
        collisionPadding={8}
        className="w-72 max-w-[calc(100vw-1rem)] min-w-(--radix-popover-trigger-width) overflow-hidden p-0"
        onInteractOutside={focus.onInteractOutside}
        onOpenAutoFocus={focus.onOpenAutoFocus}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <SearchableSelectMenu
          options={props.options}
          label={label}
          searchLabel={searchLabel}
          searchPlaceholder={props.searchPlaceholder}
          emptyMessage={props.emptyMessage}
          selectedValue={binding.selectedValue}
          query={menu.query}
          onQueryChange={menu.setQuery}
          inputRef={focus.searchRef}
          listRef={focus.listRef}
          onTab={focus.onTab}
          onSelect={menu.onSelect}
        />
      </PopoverContent>
    </Popover>
  )
}

export type SearchableSelectFieldProps = SearchableSelectValueProps &
  Readonly<{
    label: React.ReactNode
    description?: React.ReactNode
    error?: React.ReactNode
    className?: string | undefined
    triggerClassName?: string | undefined
    "aria-label"?: string | undefined
  }>

export function SearchableSelectField({
  label,
  description,
  error,
  className,
  triggerClassName,
  id: providedId,
  "aria-label": ariaLabel,
  ...props
}: SearchableSelectFieldProps) {
  const generatedId = React.useId()
  const id = providedId ?? generatedId
  const { hasDescription, hasError, describedBy } = fieldContent(id, description, error)

  return (
    <Field
      data-component="searchable-select-field"
      className={className}
      data-disabled={props.disabled || undefined}
      data-invalid={hasError || undefined}
    >
      <FieldLabel id={`${id}-label`} htmlFor={id} required={Boolean(props.required)}>
        {label}
      </FieldLabel>
      <SearchableSelectControl
        {...props}
        id={id}
        aria-label={controlLabel(label, ariaLabel, props.placeholder)}
        aria-labelledby={ariaLabel ? undefined : `${id}-label`}
        aria-describedby={describedBy || undefined}
        aria-invalid={hasError || undefined}
        className={triggerClassName}
      />
      {hasDescription ? (
        <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
      ) : null}
      <FieldError id={`${id}-error`} reserveSpace>
        {error}
      </FieldError>
    </Field>
  )
}
