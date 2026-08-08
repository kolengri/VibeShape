import { cva, type VariantProps } from "class-variance-authority"
import { isAnyObject, isFunction, isPromise } from "is-what"
import { Slot } from "radix-ui"
import * as React from "react"
import { Spinner } from "#components/spinner"
import { cn } from "#lib/cn"

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "text-sm font-medium outline-none transition-all",
    "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "data-[loading=true]:cursor-wait",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
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
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
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

function Button({
  className,
  variant = "default",
  size = "default",
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
  const showLoading = isLoading || isInternallyLoading
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
      aria-busy={showLoading || ariaBusy || undefined}
      aria-disabled={(asChild && isDisabled) || ariaDisabled || undefined}
      disabled={asChild ? undefined : isDisabled}
      className={cn(buttonVariants({ variant, size, className }))}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      {...props}
    >
      {showLoading ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
      <Slot.Slottable>{children}</Slot.Slottable>
    </Component>
  )
}

export { Button, buttonVariants }
