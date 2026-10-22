import type { VariableDefinition } from "@vibeshape/domain"
import { useCallback, useMemo, useState } from "react"
import { useDocumentDisplayUnits } from "../../document/document-display-units"
import { variableExpressionSuggestions } from "../variables/variable-expression-input"

export function useParameterFormState(variables: readonly VariableDefinition[]) {
  const displayUnits = useDocumentDisplayUnits()
  const [message, setMessage] = useState<string | null>(null)
  const suggestions = useMemo(() => variableExpressionSuggestions(variables), [variables])
  const clearSubmissionErrors = useCallback(() => {
    setMessage((current) => (current ? null : current))
  }, [])

  return {
    clearSubmissionErrors,
    displayUnits,
    message,
    setMessage,
    suggestions,
  } as const
}
