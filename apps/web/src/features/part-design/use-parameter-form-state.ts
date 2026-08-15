import type { VariableDefinition } from "@vibeshape/domain"
import { useCallback, useMemo, useRef, useState } from "react"
import { useDocumentDisplayUnits } from "../../document/document-display-units"
import { variableExpressionSuggestions } from "../variables/variable-expression-input"

export function useParameterFormState(variables: readonly VariableDefinition[]) {
  const formElementRef = useRef<HTMLFormElement>(null)
  const displayUnits = useDocumentDisplayUnits()
  const [issues, setIssues] = useState<Readonly<Record<string, string | undefined>>>({})
  const [message, setMessage] = useState<string | null>(null)
  const suggestions = useMemo(() => variableExpressionSuggestions(variables), [variables])
  const clearSubmissionErrors = useCallback(() => {
    setIssues((current) => (Object.keys(current).length > 0 ? {} : current))
    setMessage((current) => (current ? null : current))
  }, [])

  return {
    clearSubmissionErrors,
    displayUnits,
    formElementRef,
    issues,
    message,
    setIssues,
    setMessage,
    suggestions,
  } as const
}
