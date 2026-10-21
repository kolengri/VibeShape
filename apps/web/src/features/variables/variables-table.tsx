import { Button } from "@vibeshape/ui/components/button"
import { FieldError } from "@vibeshape/ui/components/field"
import type { ReactNode } from "react"

export type VariablesTableRow = Readonly<{
  id: string
  hidden?: boolean
  nameField: ReactNode
  expressionField: ReactNode
  result: ReactNode
  status: ReactNode
  nameError?: ReactNode
  expressionError?: ReactNode
  actions: ReactNode
}>

export type VariablesTableCopy = Readonly<{
  caption: string
  name: string
  expression: string
  result: string
  status: string
  actions: string
  empty: string
  noMatches: string
  add: string
}>

export function VariablesTable({
  addDisabled = false,
  copy,
  disabled = false,
  footerAction,
  onAdd,
  rows,
  searchField,
}: {
  addDisabled?: boolean
  copy: VariablesTableCopy
  disabled?: boolean
  footerAction?: ReactNode
  onAdd: () => void
  rows: readonly VariablesTableRow[]
  searchField?: ReactNode
}) {
  return (
    <div className="grid gap-3">
      {searchField}
      <div className="max-h-80 overflow-auto rounded-md border bg-background">
        <table className="w-full min-w-[40rem] table-fixed border-collapse text-left text-xs">
          <caption className="sr-only">{copy.caption}</caption>
          <thead className="sticky top-0 z-10 bg-panel-muted text-muted-foreground">
            <tr>
              <th className="w-40 px-2 py-2 font-medium" scope="col">
                {copy.name}
              </th>
              <th className="px-2 py-2 font-medium" scope="col">
                {copy.expression}
              </th>
              <th className="w-32 px-2 py-2 text-right font-medium" scope="col">
                {copy.result}
              </th>
              <th className="w-24 px-2 py-2 font-medium" scope="col">
                {copy.status}
              </th>
              <th className="w-24 px-2 py-2 text-right font-medium" scope="col">
                {copy.actions}
              </th>
            </tr>
          </thead>
          <tbody>
            {!rows.some((row) => !row.hidden) ? (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={5}>
                  {rows.length === 0 ? copy.empty : copy.noMatches}
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id} hidden={row.hidden} className="h-10 border-t align-middle">
                <td className="px-2 py-1">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-muted-foreground" aria-hidden="true">
                      #
                    </span>
                    <div className="min-w-0 flex-1">
                      {row.nameField}
                      <FieldError id={`${row.id}-name-error`}>{row.nameError}</FieldError>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1">
                  {row.expressionField}
                  <FieldError id={`${row.id}-expression-error`}>{row.expressionError}</FieldError>
                </td>
                <td className="break-words px-2 py-1 text-right font-mono tabular-nums">
                  {row.result}
                </td>
                <td className="break-words px-2 py-1">{row.status}</td>
                <td className="px-2 py-1 text-right">{row.actions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={disabled || addDisabled}
          onClick={onAdd}
        >
          {copy.add}
        </Button>
        {footerAction}
      </div>
    </div>
  )
}
