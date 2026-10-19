export type ApiAssistantErrorCode =
  | "invalid-configuration"
  | "network"
  | "authentication"
  | "rate-limit"
  | "endpoint"
  | "invalid-response"
  | "response-limit"
  | "context-limit"
  | "turn-limit"
  | "timeout"
  | "tools-unavailable"
  | "stale-project"
  | "invalid-tool"
  | "tool-failed"
  | "unsupported-attachment"
  | "queue-full"

export class ApiAssistantError extends Error {
  constructor(readonly code: ApiAssistantErrorCode) {
    super(code)
  }
}

export function apiErrorCode(error: unknown): ApiAssistantErrorCode {
  return error instanceof ApiAssistantError ? error.code : "network"
}

export function assertApiActive(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason
}

export function boundedApiJson(value: unknown, maximumBytes: number, code: ApiAssistantErrorCode) {
  const text = JSON.stringify(value)
  if (new TextEncoder().encode(text).length > maximumBytes) throw new ApiAssistantError(code)
  return text
}
