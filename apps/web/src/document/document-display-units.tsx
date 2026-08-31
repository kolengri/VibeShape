import {
  type DocumentDisplayUnits,
  defaultDocumentDisplayUnits,
  millimetersToLength,
  radiansToAngle,
  squareMillimetersToArea,
} from "@vibeshape/domain"
import { createContext, type ReactNode, useContext } from "react"

const numericLiteralPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

type FormatNumber = (value: number) => string

const DocumentDisplayUnitsContext = createContext<DocumentDisplayUnits>(defaultDocumentDisplayUnits)

const directManipulationLengthStep: Readonly<Record<DocumentDisplayUnits["length"], number>> = {
  um: 1,
  mm: 0.1,
  cm: 0.01,
  m: 0.0001,
  in: 0.001,
  ft: 0.0001,
}

export function DocumentDisplayUnitsProvider({
  children,
  displayUnits,
}: {
  children: ReactNode
  displayUnits: DocumentDisplayUnits
}) {
  return (
    <DocumentDisplayUnitsContext.Provider value={displayUnits}>
      {children}
    </DocumentDisplayUnitsContext.Provider>
  )
}

export function useDocumentDisplayUnits() {
  return useContext(DocumentDisplayUnitsContext)
}

export function normalizeExpressionWithDisplayUnit(
  rawExpression: string,
  unit: DocumentDisplayUnits["length"] | DocumentDisplayUnits["angle"],
) {
  const expression = rawExpression.trim()
  return numericLiteralPattern.test(expression) ? `${expression} ${unit}` : expression
}

function stableExpressionNumber(value: number) {
  return Number(value.toPrecision(12)).toString()
}

export function defaultLengthExpression(millimeters: number, unit: DocumentDisplayUnits["length"]) {
  return `${stableExpressionNumber(millimetersToLength(millimeters, unit))} ${unit}`
}

export function positiveDirectManipulationLengthExpression(
  millimeters: number,
  unit: DocumentDisplayUnits["length"],
) {
  const step = directManipulationLengthStep[unit]
  const value = millimetersToLength(millimeters, unit)
  const snapped = Math.max(step, Math.round(value / step) * step)
  return `${stableExpressionNumber(snapped)} ${unit}`
}

export function defaultAngleExpression(radians: number, unit: DocumentDisplayUnits["angle"]) {
  return `${stableExpressionNumber(radiansToAngle(radians, unit))} ${unit}`
}

export function formatDisplayLength(
  millimeters: number,
  unit: DocumentDisplayUnits["length"],
  formatNumber: FormatNumber,
) {
  return `${formatNumber(millimetersToLength(millimeters, unit))} ${unit}`
}

export function formatDisplayArea(
  squareMillimeters: number,
  unit: DocumentDisplayUnits["length"],
  formatNumber: FormatNumber,
) {
  return `${formatNumber(squareMillimetersToArea(squareMillimeters, unit))} ${unit}²`
}

export function formatDisplayAngle(
  radians: number,
  unit: DocumentDisplayUnits["angle"],
  formatNumber: FormatNumber,
) {
  return `${formatNumber(radiansToAngle(radians, unit))} ${unit}`
}
