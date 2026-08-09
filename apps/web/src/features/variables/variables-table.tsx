import { Button } from "@vibeshape/ui/components/button"
import { FieldError } from "@vibeshape/ui/components/field"
import type { ReactNode } from "react"

export type VariablesTableRow = Readonly<{
  id: string
  nameField: ReactNode
  expressionField: ReactNode
  result: ReactNode
  status: ReactNode
  nameError?: ReactNode
  expressionError?: ReactNode
  removeDisabled?: boolean
  removeDisabledReason?: string
  onRemove: () => void
}>

export type VariablesTableCopy = Readonly<{
  caption: string
  name: string
  expression: string
  result: string
  status: string
  actions: string
  empty: string
  add: string
  remove: string
}>

export function VariablesTable({
  addDisabled = false,
  copy,
  disabled = false,
  footerAction,
  onAdd,
  rows,
}: {
  addDisabled?: boolean
  copy: VariablesTableCopy
  disabled?: boolean
  footerAction?: ReactNode
  onAdd: () => void
  rows: readonly VariablesTableRow[]
}) {
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full min-w-[44rem] border-collapse text-left text-xs">
          <caption className="sr-only">{copy.caption}</caption>
          <thead className="bg-panel-muted text-muted-foreground">
            <tr>
              <th className="w-44 px-2 py-2 font-medium" scope="col">
                {copy.name}
              </th>
              <th className="min-w-64 px-2 py-2 font-medium" scope="col">
                {copy.expression}
              </th>
              <th className="w-32 px-2 py-2 text-right font-medium" scope="col">
                {copy.result}
              </th>
              <th className="w-24 px-2 py-2 font-medium" scope="col">
                {copy.status}
              </th>
              <th className="w-20 px-2 py-2 text-right font-medium" scope="col">
                {copy.actions}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={5}>
                  {copy.empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="px-2 py-2">
                    <div className="flex items-start gap-1">
                      <span className="pt-2 font-mono text-muted-foreground" aria-hidden="true">
                        #
                      </span>
                      <div className="min-w-0 flex-1">
                        {row.nameField}
                        <FieldError id={`${row.id}-name-error`}>{row.nameError}</FieldError>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {row.expressionField}
                    <FieldError id={`${row.id}-expression-error`}>{row.expressionError}</FieldError>
                  </td>
                  <td className="px-2 py-3 text-right font-mono tabular-nums">{row.result}</td>
                  <td className="px-2 py-3">{row.status}</td>
                  <td className="px-2 py-2 text-right">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={disabled || row.removeDisabled}
                      title={row.removeDisabledReason}
                      onClick={row.onRemove}
                    >
                      {copy.remove}
                    </Button>
                  </td>
                </tr>
              ))
            )}
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
