import { createContext, type ReactNode, useContext, useId } from "react"
import { createTranslator } from "use-intl"
import { InformationIcon } from "#components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "#components/popover"
import en from "../messages/en.json"

const translate = createTranslator({ locale: "en", messages: en.ui.fieldHelp })
const HelpLabelContext = createContext<(subject: ReactNode) => ReactNode>((subject) =>
  translate.rich("forLabel", { subject: () => <>{subject}</> }),
)

export function FieldHelpProvider({
  children,
  formatLabel,
}: {
  children: ReactNode
  formatLabel: (subject: ReactNode) => ReactNode
}) {
  return <HelpLabelContext.Provider value={formatLabel}>{children}</HelpLabelContext.Provider>
}

export function FieldHelp({
  label,
  children,
  descriptionId,
}: {
  label: ReactNode
  children: ReactNode
  descriptionId?: string | undefined
}) {
  const labelId = useId()
  const dialogLabelId = useId()
  const formatLabel = useContext(HelpLabelContext)
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* biome-ignore lint/a11y/useSemanticElements: Native buttons inherit disabled fieldsets; guidance must remain interactive. */}
        <span
          role="button"
          tabIndex={0}
          data-slot="field-help"
          aria-labelledby={labelId}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              if (!event.repeat) event.currentTarget.click()
            }
          }}
          className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <InformationIcon className="size-4" aria-hidden="true" />
          <span id={labelId} className="sr-only">
            {formatLabel(label)}
          </span>
        </span>
      </PopoverTrigger>
      {descriptionId ? (
        <span id={descriptionId} className="sr-only">
          {children}
        </span>
      ) : null}
      <PopoverContent
        aria-labelledby={dialogLabelId}
        align="start"
        collisionPadding={8}
        className="max-h-(--radix-popover-content-available-height) w-72 max-w-(--radix-popover-content-available-width) overflow-y-auto break-words p-3 text-xs leading-5"
      >
        <span id={dialogLabelId} className="sr-only">
          {label}
        </span>
        {children}
      </PopoverContent>
    </Popover>
  )
}
