import { cva, type VariantProps } from "class-variance-authority"
import { isAnyObject, isFunction, isPromise } from "is-what"
import { Slot } from "radix-ui"
import * as React from "react"
import { useReportActivity } from "#components/activity"
import { ChevronDownIcon } from "#components/icons"
import { Spinner } from "#components/spinner"
import { cn } from "#lib/cn"

const standardButtonSize = "h-8 gap-1.5 px-3 py-1 text-sm"
const standardIconButtonSize = "size-8 p-0"

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "text-sm font-medium outline-none transition-all",
    "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "data-[loading=true]:cursor-wait",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([role=img])]:size-5",
  ],
  {
    variants: {
      dropdown: {
        true: "[&>svg[data-slot=button-dropdown-indicator]]:size-2.5",
      },
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: standardButtonSize,
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([role=img])]:size-4",
        sm: standardButtonSize,
        content: "h-auto min-h-8 gap-1.5 whitespace-normal px-3 py-2 text-sm",
        icon: standardIconButtonSize,
        "icon-xs": "size-6 rounded-md p-0 [&_svg:not([role=img])]:size-4",
        "icon-sm": standardIconButtonSize,
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

type ButtonClickHandler = (event: React.MouseEvent<HTMLButtonElement>) => unknown

export type ButtonProps = Omit<React.ComponentProps<"button">, "onClick" | "onDoubleClick"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    isLoading?: boolean
    onClick?: ButtonClickHandler
  }

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (!isPromise(value) && !isAnyObject(value) && !isFunction(value)) {
    return false
  }

  return "then" in value && isFunction(value.then)
}

function buttonPendingPresentation(
  isLoading: boolean,
  isInternallyLoading: boolean,
  ariaBusy: React.AriaAttributes["aria-busy"],
) {
  const showLoading = isLoading || isInternallyLoading
  return {
    showLoading,
    activity: showLoading || ariaBusy === true || ariaBusy === "true",
    ariaBusy: showLoading || ariaBusy || undefined,
  }
}

function ButtonDropdownIndicator({ visible }: { visible: boolean }) {
  return visible ? (
    <ChevronDownIcon
      data-slot="button-dropdown-indicator"
      aria-hidden="true"
      className="absolute right-0 bottom-0"
    />
  ) : null
}

function Button({
  className,
  variant = "default",
  size = "default",
  dropdown = false,
  asChild = false,
  isLoading = false,
  disabled = false,
  children,
  onClick,
  "aria-busy": ariaBusy,
  "aria-disabled": ariaDisabled,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button"
  const pendingRef = React.useRef(false)
  const [isInternallyLoading, setIsInternallyLoading] = React.useState(false)
  const presentation = buttonPendingPresentation(isLoading, isInternallyLoading, ariaBusy)
  const { showLoading } = presentation
  const centralized = useReportActivity(presentation.activity)
  const isDisabled = disabled || showLoading

  const finishPendingAction = React.useCallback(() => {
    pendingRef.current = false
    setIsInternallyLoading(false)
  }, [])

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (isDisabled || pendingRef.current || event.detail > 1) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      const result = onClick?.(event)

      if (!isPromiseLike(result)) {
        return
      }

      pendingRef.current = true
      setIsInternallyLoading(true)
      void Promise.resolve(result).then(finishPendingAction, finishPendingAction)
    },
    [finishPendingAction, isDisabled, onClick],
  )

  const handleDoubleClick = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <Component
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={showLoading}
      aria-busy={presentation.ariaBusy}
      aria-disabled={(asChild && isDisabled) || ariaDisabled || undefined}
      disabled={asChild ? undefined : isDisabled}
      className={cn(buttonVariants({ variant, size, dropdown, className }))}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      {...props}
    >
      {showLoading && !centralized ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
      <Slot.Slottable>{children}</Slot.Slottable>
      <ButtonDropdownIndicator visible={dropdown === true} />
    </Component>
  )
}

export { Button, buttonVariants }
