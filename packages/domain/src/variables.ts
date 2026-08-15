import { isAnyObject, isArray } from "is-what"
import { z } from "zod"
import { variableIdSchema } from "./identifiers"
import {
  type AngleQuantity,
  angleToRadians,
  createAngleQuantity,
  createLengthQuantity,
  createScalarQuantity,
  type LengthQuantity,
  lengthToMillimeters,
  type Quantity,
  quantitySchema,
  type ScalarQuantity,
} from "./units"

const MAX_VARIABLES = 4_096
const MAX_EXPRESSION_TOKENS = 512
const MAX_EXPRESSION_DEPTH = 32
const MAX_VARIABLE_DEPENDENCY_DEPTH = 256

export const variableNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Variable names must start with an ASCII letter or underscore and contain only ASCII letters, digits, or underscores.",
  )

export const variableExpressionSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((expression) => expression.trim() === expression, "Expressions must be normalized.")

export const variableDefinitionSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: variableIdSchema,
    name: variableNameSchema,
    expression: variableExpressionSchema,
  })
  .strict()

const structuralVariableDefinitionsSchema = z.array(variableDefinitionSchema).max(MAX_VARIABLES)

export type VariableDefinition = Readonly<z.infer<typeof variableDefinitionSchema>>
export type ExpressionDimension = Quantity["dimension"]

export type ExpressionValue = Readonly<{
  dimension: ExpressionDimension
  value: number
}>

export type VariableExpressionDiagnosticCode =
  | "duplicate-variable-id"
  | "duplicate-variable-name"
  | "invalid-expression-syntax"
  | "expression-too-complex"
  | "unknown-expression-unit"
  | "unknown-variable"
  | "cyclic-variable-dependency"
  | "expression-dimension-mismatch"
  | "expression-division-by-zero"
  | "non-finite-expression-result"

export type VariableExpressionDiagnostic = Readonly<{
  code: VariableExpressionDiagnosticCode
  message: string
  variableName: string | null
  position: number | null
}>

export type EvaluatedVariable = Readonly<{
  definition: VariableDefinition
  value: ExpressionValue
  dependencies: readonly string[]
}>

export type VariableEvaluationResult =
  | {
      ok: true
      valuesByName: ReadonlyMap<string, EvaluatedVariable>
      valuesById: ReadonlyMap<VariableDefinition["id"], EvaluatedVariable>
    }
  | { ok: false; diagnostic: VariableExpressionDiagnostic }

type Token =
  | { type: "number"; value: number; unit: string | null; position: number }
  | { type: "variable"; name: string; position: number }
  | { type: "+" | "-" | "*" | "/" | "(" | ")"; position: number }
  | { type: "end"; position: number }

type TokenizeResult =
  | { ok: true; tokens: readonly Token[] }
  | { ok: false; diagnostic: VariableExpressionDiagnostic }

type TokenReadResult =
  | { ok: true; token: Token; nextPosition: number }
  | { ok: false; diagnostic: VariableExpressionDiagnostic }

type ParseResult =
  | { ok: true; value: ExpressionValue; references: readonly string[] }
  | { ok: false; diagnostic: VariableExpressionDiagnostic }

type ValueResult =
  | { ok: true; value: ExpressionValue }
  | { ok: false; diagnostic: VariableExpressionDiagnostic }

const numberPattern = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*/
const unitFactors = new Map<string, ExpressionValue>([
  ["um", { dimension: "length", value: lengthToMillimeters(1, "um") }],
  ["mm", { dimension: "length", value: lengthToMillimeters(1, "mm") }],
  ["cm", { dimension: "length", value: lengthToMillimeters(1, "cm") }],
  ["m", { dimension: "length", value: lengthToMillimeters(1, "m") }],
  ["in", { dimension: "length", value: lengthToMillimeters(1, "in") }],
  ["ft", { dimension: "length", value: lengthToMillimeters(1, "ft") }],
  ["deg", { dimension: "angle", value: angleToRadians(1, "deg") }],
  ["rad", { dimension: "angle", value: angleToRadians(1, "rad") }],
])

function failure(
  code: VariableExpressionDiagnosticCode,
  message: string,
  variableName: string | null = null,
  position: number | null = null,
): { ok: false; diagnostic: VariableExpressionDiagnostic } {
  return { ok: false, diagnostic: { code, message, variableName, position } }
}

function isWhitespace(character: string) {
  return /\s/.test(character)
}

function skipWhitespace(expression: string, start: number) {
  let position = start
  while (position < expression.length && isWhitespace(expression[position] as string)) {
    position += 1
  }
  return position
}

function readVariableToken(
  expression: string,
  position: number,
  variableName: string | null,
): TokenReadResult {
  const match = expression.slice(position + 1).match(identifierPattern)
  return match
    ? {
        ok: true,
        token: { type: "variable", name: match[0], position },
        nextPosition: position + match[0].length + 1,
      }
    : failure(
        "invalid-expression-syntax",
        "A variable reference must use # followed by a valid variable name.",
        variableName,
        position,
      )
}

function readNumberToken(
  expression: string,
  position: number,
  numericSource: string,
  variableName: string | null,
): TokenReadResult {
  const unitPosition = skipWhitespace(expression, position + numericSource.length)
  const unitMatch = expression.slice(unitPosition).match(/^[A-Za-z]+/)
  const unit = unitMatch?.[0] ?? null
  const value = Number(numericSource)
  if (!Number.isFinite(value)) {
    return failure(
      "non-finite-expression-result",
      "Numeric literals must be finite.",
      variableName,
      position,
    )
  }
  return {
    ok: true,
    token: { type: "number", value, unit, position },
    nextPosition: unitPosition + (unit?.length ?? 0),
  }
}

function readToken(
  expression: string,
  position: number,
  variableName: string | null,
): TokenReadResult {
  const character = expression[position] as string
  if ("+-*/()".includes(character)) {
    return {
      ok: true,
      token: { type: character as "+" | "-" | "*" | "/" | "(" | ")", position },
      nextPosition: position + 1,
    }
  }
  if (character === "#") return readVariableToken(expression, position, variableName)
  const numberMatch = expression.slice(position).match(numberPattern)
  if (numberMatch) return readNumberToken(expression, position, numberMatch[0], variableName)
  const identifier = expression.slice(position).match(/^[A-Za-z]+/)?.[0]
  return identifier
    ? failure(
        "invalid-expression-syntax",
        `Unexpected identifier ${identifier}. Functions are not part of expression schema version 0.`,
        variableName,
        position,
      )
    : failure(
        "invalid-expression-syntax",
        `Unexpected character ${JSON.stringify(character)}.`,
        variableName,
        position,
      )
}

function tokenize(expression: string, variableName: string | null): TokenizeResult {
  const tokens: Token[] = []
  let position = 0

  while (position < expression.length) {
    position = skipWhitespace(expression, position)
    if (position >= expression.length) break
    if (tokens.length >= MAX_EXPRESSION_TOKENS) {
      return failure(
        "expression-too-complex",
        `Expression exceeds the ${MAX_EXPRESSION_TOKENS}-token limit.`,
        variableName,
        position,
      )
    }
    const read = readToken(expression, position, variableName)
    if (!read.ok) return read
    tokens.push(read.token)
    position = read.nextPosition
  }

  tokens.push({ type: "end", position: expression.length })
  return { ok: true, tokens }
}

function finiteValue(
  value: ExpressionValue,
  variableName: string | null,
  position: number,
): ValueResult {
  if (!Number.isFinite(value.value)) {
    return failure(
      "non-finite-expression-result",
      "The expression result must be finite.",
      variableName,
      position,
    )
  }
  return {
    ok: true,
    value: { ...value, value: Object.is(value.value, -0) ? 0 : value.value },
  }
}

function addOrSubtract(
  left: ExpressionValue,
  right: ExpressionValue,
  operator: "+" | "-",
  variableName: string | null,
  position: number,
): ValueResult {
  if (left.dimension !== right.dimension) {
    return failure(
      "expression-dimension-mismatch",
      `Operator ${operator} requires matching dimensions, received ${left.dimension} and ${right.dimension}.`,
      variableName,
      position,
    )
  }
  return finiteValue(
    {
      dimension: left.dimension,
      value: operator === "+" ? left.value + right.value : left.value - right.value,
    },
    variableName,
    position,
  )
}

function multiply(
  left: ExpressionValue,
  right: ExpressionValue,
  variableName: string | null,
  position: number,
): ValueResult {
  if (left.dimension !== "scalar" && right.dimension !== "scalar") {
    return failure(
      "expression-dimension-mismatch",
      "Multiplication requires at least one scalar operand in expression schema version 0.",
      variableName,
      position,
    )
  }
  return finiteValue(
    {
      dimension: left.dimension === "scalar" ? right.dimension : left.dimension,
      value: left.value * right.value,
    },
    variableName,
    position,
  )
}

function divide(
  left: ExpressionValue,
  right: ExpressionValue,
  variableName: string | null,
  position: number,
): ValueResult {
  if (right.value === 0) {
    return failure(
      "expression-division-by-zero",
      "Expressions cannot divide by zero.",
      variableName,
      position,
    )
  }
  if (right.dimension === "scalar") {
    return finiteValue(
      { dimension: left.dimension, value: left.value / right.value },
      variableName,
      position,
    )
  }
  if (left.dimension === right.dimension) {
    return finiteValue(
      { dimension: "scalar", value: left.value / right.value },
      variableName,
      position,
    )
  }
  return failure(
    "expression-dimension-mismatch",
    `Division cannot combine ${left.dimension} and ${right.dimension}.`,
    variableName,
    position,
  )
}

class ExpressionParser {
  #index = 0
  #depth = 0
  readonly #references: string[] = []

  constructor(
    private readonly tokens: readonly Token[],
    private readonly variableName: string | null,
    private readonly resolveVariable: (name: string, position: number) => ValueResult,
  ) {}

  parse(): ParseResult {
    const value = this.#parseAddition()
    if (!value.ok) return value
    const token = this.#current()
    if (token.type !== "end") {
      return failure(
        "invalid-expression-syntax",
        `Unexpected token ${token.type}.`,
        this.variableName,
        token.position,
      )
    }
    return { ok: true, value: value.value, references: [...new Set(this.#references)] }
  }

  #current() {
    return this.tokens[this.#index] as Token
  }

  #advance() {
    const token = this.#current()
    this.#index += 1
    return token
  }

  #parseAddition(): ValueResult {
    let left = this.#parseMultiplication()
    while (left.ok && (this.#current().type === "+" || this.#current().type === "-")) {
      const operator = this.#advance() as { type: "+" | "-"; position: number }
      const right = this.#parseMultiplication()
      if (!right.ok) return right
      left = addOrSubtract(
        left.value,
        right.value,
        operator.type,
        this.variableName,
        operator.position,
      )
    }
    return left
  }

  #parseMultiplication(): ValueResult {
    let left = this.#parseUnary()
    while (left.ok && (this.#current().type === "*" || this.#current().type === "/")) {
      const operator = this.#advance() as { type: "*" | "/"; position: number }
      const right = this.#parseUnary()
      if (!right.ok) return right
      left =
        operator.type === "*"
          ? multiply(left.value, right.value, this.variableName, operator.position)
          : divide(left.value, right.value, this.variableName, operator.position)
    }
    return left
  }

  #parseUnary(): ValueResult {
    const token = this.#current()
    if (token.type !== "+" && token.type !== "-") return this.#parsePrimary()
    this.#advance()
    const operand = this.#parseUnary()
    return operand.ok
      ? finiteValue(
          {
            dimension: operand.value.dimension,
            value: token.type === "-" ? -operand.value.value : operand.value.value,
          },
          this.variableName,
          token.position,
        )
      : operand
  }

  #parsePrimary(): ValueResult {
    const token = this.#advance()
    if (token.type === "number") {
      if (!token.unit) return { ok: true, value: { dimension: "scalar", value: token.value } }
      const unit = unitFactors.get(token.unit)
      return unit
        ? finiteValue(
            { dimension: unit.dimension, value: token.value * unit.value },
            this.variableName,
            token.position,
          )
        : failure(
            "unknown-expression-unit",
            `Expression unit ${token.unit} is not supported.`,
            this.variableName,
            token.position,
          )
    }
    if (token.type === "variable") {
      this.#references.push(token.name)
      return this.resolveVariable(token.name, token.position)
    }
    if (token.type === "(") {
      this.#depth += 1
      if (this.#depth > MAX_EXPRESSION_DEPTH) {
        return failure(
          "expression-too-complex",
          `Expression nesting exceeds the depth limit of ${MAX_EXPRESSION_DEPTH}.`,
          this.variableName,
          token.position,
        )
      }
      const value = this.#parseAddition()
      this.#depth -= 1
      if (!value.ok) return value
      const closing = this.#advance()
      return closing.type === ")"
        ? value
        : failure(
            "invalid-expression-syntax",
            "A parenthesized expression is missing its closing parenthesis.",
            this.variableName,
            closing.position,
          )
    }
    return failure(
      "invalid-expression-syntax",
      "Expected a number, variable reference, unary operator, or parenthesized expression.",
      this.variableName,
      token.position,
    )
  }
}

function evaluateExpressionWithResolver(
  expression: string,
  variableName: string | null,
  resolveVariable: (name: string, position: number) => ValueResult,
): ParseResult {
  const tokenized = tokenize(expression, variableName)
  if (!tokenized.ok) return tokenized
  return new ExpressionParser(tokenized.tokens, variableName, resolveVariable).parse()
}

export function evaluateExpression(
  expression: string,
  valuesByName: ReadonlyMap<string, ExpressionValue | EvaluatedVariable>,
): ParseResult {
  const parsedExpression = variableExpressionSchema.safeParse(expression)
  if (!parsedExpression.success) {
    return failure("invalid-expression-syntax", "The expression source is invalid.")
  }
  return evaluateExpressionWithResolver(parsedExpression.data, null, (name, position) => {
    const resolved = valuesByName.get(name)
    return resolved
      ? { ok: true, value: "definition" in resolved ? resolved.value : resolved }
      : failure("unknown-variable", `Variable #${name} does not exist.`, null, position)
  })
}

export function variableReferencesInExpression(expression: string) {
  const parsedExpression = variableExpressionSchema.safeParse(expression)
  if (!parsedExpression.success) return []
  const tokenized = tokenize(parsedExpression.data, null)
  if (!tokenized.ok) return []
  return [
    ...new Set(
      tokenized.tokens.flatMap((token) => (token.type === "variable" ? [token.name] : [])),
    ),
  ]
}

export function rewriteVariableReferencesInExpression(
  expression: string,
  previousName: string,
  name: string,
) {
  const parsedExpression = variableExpressionSchema.safeParse(expression)
  if (!parsedExpression.success || previousName === name) return expression
  const tokenized = tokenize(parsedExpression.data, null)
  if (!tokenized.ok) return expression
  const references = tokenized.tokens.filter(
    (token) => token.type === "variable" && token.name === previousName,
  )
  if (references.length === 0) return expression
  let cursor = 0
  let rewritten = ""
  for (const reference of references) {
    rewritten += `${expression.slice(cursor, reference.position)}#${name}`
    cursor = reference.position + previousName.length + 1
  }
  return rewritten + expression.slice(cursor)
}

type ParameterRewriteFrame = Readonly<{
  value: unknown
  assign: (value: unknown) => void
}>

type QuantityReferenceRewrite =
  | { kind: "not-quantity" }
  | { kind: "quantity"; value: unknown }
  | { kind: "error"; message: string }

function rewriteQuantityVariableReference(
  value: unknown,
  previousName: string,
  name: string,
): QuantityReferenceRewrite {
  const quantity = quantitySchema.safeParse(value)
  if (!quantity.success) return { kind: "not-quantity" }
  const expression = quantity.data.source.expression
  const rewritten = expression
    ? rewriteVariableReferencesInExpression(expression, previousName, name)
    : expression
  if (rewritten === expression) return { kind: "quantity", value }
  const nextQuantity = quantitySchema.safeParse({
    ...quantity.data,
    source: { ...quantity.data.source, expression: rewritten },
  })
  return nextQuantity.success
    ? { kind: "quantity", value: nextQuantity.data }
    : {
        kind: "error",
        message: "The renamed variable reference exceeds a quantity expression limit.",
      }
}

function enqueueParameterChildren(frame: ParameterRewriteFrame, pending: ParameterRewriteFrame[]) {
  if (isArray(frame.value)) {
    const array: unknown[] = new Array(frame.value.length)
    frame.assign(array)
    for (let index = frame.value.length - 1; index >= 0; index -= 1) {
      pending.push({
        value: frame.value[index],
        assign: (value) => (array[index] = value),
      })
    }
    return true
  }
  if (!isAnyObject(frame.value)) return false
  const object: Record<string, unknown> = {}
  frame.assign(object)
  const entries = Object.entries(frame.value)
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry) continue
    const [key, value] = entry
    pending.push({ value, assign: (nextValue) => (object[key] = nextValue) })
  }
  return true
}

export function rewriteParameterVariableReferences(
  input: unknown,
  previousName: string,
  name: string,
) {
  let result: unknown
  const pending: ParameterRewriteFrame[] = [{ value: input, assign: (value) => (result = value) }]
  while (pending.length > 0) {
    const frame = pending.pop()
    if (!frame) continue
    const quantity = rewriteQuantityVariableReference(frame.value, previousName, name)
    if (quantity.kind === "error") return { ok: false as const, message: quantity.message }
    if (quantity.kind === "quantity") {
      frame.assign(quantity.value)
      continue
    }
    if (enqueueParameterChildren(frame, pending)) continue
    frame.assign(frame.value)
  }
  return { ok: true as const, value: result }
}

export function parameterVariableReferences(input: unknown) {
  const references = new Set<string>()
  const pending: unknown[] = [input]
  while (pending.length > 0) {
    const value = pending.pop()
    const quantity = quantitySchema.safeParse(value)
    if (quantity.success) {
      for (const name of variableReferencesInExpression(quantity.data.source.expression ?? "")) {
        references.add(name)
      }
      continue
    }
    if (isArray(value)) {
      pending.push(...value)
      continue
    }
    if (isAnyObject(value)) {
      pending.push(...Object.values(value))
    }
  }
  return [...references]
}

function duplicateDiagnostic(
  definitions: readonly VariableDefinition[],
): VariableExpressionDiagnostic | null {
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      return {
        code: "duplicate-variable-id",
        message: `Variable ID ${definition.id} appears more than once.`,
        variableName: definition.name,
        position: null,
      }
    }
    if (names.has(definition.name)) {
      return {
        code: "duplicate-variable-name",
        message: `Variable name ${definition.name} appears more than once.`,
        variableName: definition.name,
        position: null,
      }
    }
    ids.add(definition.id)
    names.add(definition.name)
  }
  return null
}

function evaluateParsedVariableDefinitions(
  definitions: readonly VariableDefinition[],
): VariableEvaluationResult {
  const duplicate = duplicateDiagnostic(definitions)
  if (duplicate) return { ok: false, diagnostic: duplicate }

  const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]))
  const valuesByName = new Map<string, EvaluatedVariable>()
  const valuesById = new Map<VariableDefinition["id"], EvaluatedVariable>()
  const active = new Set<string>()

  const evaluate = (name: string, position: number): ValueResult => {
    const existing = valuesByName.get(name)
    if (existing) return { ok: true, value: existing.value }
    const definition = definitionsByName.get(name)
    if (!definition) {
      return failure("unknown-variable", `Variable #${name} does not exist.`, name, position)
    }
    if (active.has(name)) {
      return failure(
        "cyclic-variable-dependency",
        `Variable #${name} participates in a dependency cycle.`,
        name,
        position,
      )
    }
    if (active.size >= MAX_VARIABLE_DEPENDENCY_DEPTH) {
      return failure(
        "expression-too-complex",
        `Variable dependency depth exceeds the limit of ${MAX_VARIABLE_DEPENDENCY_DEPTH}.`,
        name,
        position,
      )
    }

    active.add(name)
    const parsed = evaluateExpressionWithResolver(definition.expression, name, evaluate)
    active.delete(name)
    if (!parsed.ok) return parsed
    const evaluated: EvaluatedVariable = {
      definition,
      value: parsed.value,
      dependencies: parsed.references,
    }
    valuesByName.set(name, evaluated)
    valuesById.set(definition.id, evaluated)
    return { ok: true, value: evaluated.value }
  }

  for (const definition of definitions) {
    const result = evaluate(definition.name, 0)
    if (!result.ok) return result
  }

  return { ok: true, valuesByName, valuesById }
}

export function evaluateVariableDefinitions(input: unknown): VariableEvaluationResult {
  const parsed = structuralVariableDefinitionsSchema.safeParse(input)
  return parsed.success
    ? evaluateParsedVariableDefinitions(parsed.data)
    : failure("invalid-expression-syntax", "The variable definitions are invalid.")
}

export const variableDefinitionsSchema = structuralVariableDefinitionsSchema.superRefine(
  (definitions, context) => {
    const result = evaluateParsedVariableDefinitions(definitions)
    if (!result.ok) {
      const index = result.diagnostic.variableName
        ? definitions.findIndex(({ name }) => name === result.diagnostic.variableName)
        : -1
      context.addIssue({
        code: "custom",
        path: index >= 0 ? [index, "expression"] : [],
        message: result.diagnostic.message,
      })
    }
  },
)

function expressionQuantitySourceValue(quantity: Quantity, canonicalValue: number) {
  if (quantity.dimension === "length") {
    return canonicalValue / lengthToMillimeters(1, quantity.source.unit)
  }
  if (quantity.dimension === "angle") {
    return canonicalValue / angleToRadians(1, quantity.source.unit)
  }
  return canonicalValue
}

export function resolveQuantityExpression(
  quantity: Quantity,
  valuesByName: ReadonlyMap<string, ExpressionValue | EvaluatedVariable>,
):
  | { ok: true; quantity: LengthQuantity | AngleQuantity | ScalarQuantity }
  | { ok: false; diagnostic: VariableExpressionDiagnostic } {
  const expression = quantity.source.expression
  if (!expression) return { ok: true, quantity }
  const resolved = evaluateExpression(expression, valuesByName)
  if (!resolved.ok) return resolved
  if (resolved.value.dimension !== quantity.dimension) {
    return failure(
      "expression-dimension-mismatch",
      `The expression resolves to ${resolved.value.dimension}, but the parameter requires ${quantity.dimension}.`,
    )
  }
  const sourceValue = expressionQuantitySourceValue(quantity, resolved.value.value)
  switch (quantity.dimension) {
    case "length":
      return {
        ok: true,
        quantity: createLengthQuantity(sourceValue, quantity.source.unit, expression),
      }
    case "angle":
      return {
        ok: true,
        quantity: createAngleQuantity(sourceValue, quantity.source.unit, expression),
      }
    case "scalar":
      return { ok: true, quantity: createScalarQuantity(sourceValue, expression) }
  }
}
