import { Popover, PopoverContent, PopoverTrigger } from "@vibeshape/ui/components/popover"
import { cn } from "@vibeshape/ui/lib/cn"
import { type MouseEvent, type ReactElement, useEffect, useId, useState } from "react"

function ActionBlockedReason({
  className,
  id,
  reason,
}: {
  className?: string | undefined
  id?: string
  reason: string
}) {
  return (
    <p id={id} className={cn("text-xs text-muted-foreground", className)}>
      {reason}
    </p>
  )
}

type ActionAvailabilityState = Readonly<{
  describedBy: string | undefined
  blockActivation: (event: MouseEvent<HTMLButtonElement>) => boolean
}>

type ActionAvailabilityProps = Readonly<{
  children: (availability: ActionAvailabilityState) => ReactElement
  disabledReason?: string | null | undefined
}> &
  (
    | Readonly<{ presentation: "persistent"; reasonClassName?: string }>
    | Readonly<{ presentation: "disclosure"; disclosureLabel: string }>
  )

/** Presents caller-owned eligibility without deciding whether an action is available. */
export function ActionAvailability(props: ActionAvailabilityProps) {
  const descriptionId = useId()
  const [disclosedReason, setDisclosedReason] = useState<string | null>(null)
  const reason = props.disabledReason
  useEffect(() => setDisclosedReason(null), [reason])
  const action = props.children({
    describedBy: reason ? descriptionId : undefined,
    blockActivation: (event) => {
      if (!reason) return false
      event.preventDefault()
      event.stopPropagation()
      if (props.presentation === "disclosure") setDisclosedReason(reason)
      return true
    },
  })

  if (props.presentation === "persistent") {
    return (
      <>
        {action}
        {reason ? (
          <ActionBlockedReason
            id={descriptionId}
            reason={reason}
            className={props.reasonClassName}
          />
        ) : null}
      </>
    )
  }

  if (!reason) return action

  return (
    <Popover
      open={disclosedReason === reason}
      onOpenChange={(open) => setDisclosedReason(open ? reason : null)}
      modal={false}
    >
      <PopoverTrigger asChild>{action}</PopoverTrigger>
      <ActionBlockedReason id={descriptionId} reason={reason} className="sr-only" />
      <PopoverContent
        aria-label={props.disclosureLabel}
        className="max-w-64 p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ActionBlockedReason reason={reason} />
      </PopoverContent>
    </Popover>
  )
}
