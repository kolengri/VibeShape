import type { ValidationError } from "@tanstack/react-form"
import { isAnyObject, isError, isString } from "is-what"

export function validationMessage(error: ValidationError | undefined): string | undefined {
  if (isString(error)) {
    return error
  }

  if (isError(error)) {
    return error.message
  }

  if (isAnyObject(error)) {
    const message = Reflect.get(error, "message")
    return isString(message) ? message : undefined
  }

  return undefined
}
