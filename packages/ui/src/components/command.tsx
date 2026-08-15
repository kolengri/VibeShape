import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"
import type * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#components/dialog"
import { cn } from "#lib/cn"

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  )
}

type CommandDialogProps = React.ComponentProps<typeof Dialog> &
  Readonly<{
    children: React.ReactNode
    className?: string
    closeLabel: string
    description: string
    onCloseAutoFocus?: React.ComponentProps<typeof DialogContent>["onCloseAutoFocus"]
    searchLabel: string
    showCloseButton?: boolean
    title: string
  }>

function CommandDialog({
  children,
  className,
  closeLabel,
  description,
  onCloseAutoFocus,
  searchLabel,
  showCloseButton = true,
  title,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        closeLabel={closeLabel}
        className={cn("gap-0 overflow-hidden p-0", className)}
        onCloseAutoFocus={onCloseAutoFocus}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command label={searchLabel}>{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-11 items-center gap-2 border-b px-3">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-80 scroll-py-1 overflow-x-hidden overflow-y-auto", className)}
      {...props}
    />
  )
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-8 text-center text-sm text-muted-foreground"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground",
        "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
        "[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
        "[&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none select-none",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-55",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="command-shortcut"
      className={cn(
        "ml-auto shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
