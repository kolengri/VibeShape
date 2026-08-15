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
