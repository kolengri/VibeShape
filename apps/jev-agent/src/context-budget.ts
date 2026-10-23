import type { DecisionState, Observation } from "./contracts"
import { JevFailure } from "./failure"

export function boundedObservation(observation: Observation): Observation {
  const text = JSON.stringify(observation.result)
  return Buffer.byteLength(JSON.stringify(observation)) <= 24_000
    ? observation
    : {
        tool: observation.tool,
        arguments: { truncated: true, text: JSON.stringify(observation.arguments).slice(0, 6000) },
        result: { truncated: true, text: text.slice(0, 6000) },
      }
}
function compactAnswers(state: DecisionState) {
  const session = state.session
  if (!session) return
  while (
    session.answeredQuestions.length > 0 &&
    Buffer.byteLength(JSON.stringify({ ...state, photos: [] })) > 64_000
  ) {
    session.answeredQuestions.shift()
    session.omittedAnsweredQuestions = (session.omittedAnsweredQuestions ?? 0) + 1
  }
}

export function boundContext(state: DecisionState) {
  const bytes = () => Buffer.byteLength(JSON.stringify({ ...state, photos: [] }))
  while (state.history.length > 1 && bytes() > 64_000) state.history.shift()
  if (bytes() > 64_000) compactAnswers(state)
  if (bytes() > 64_000)
    throw new JevFailure("The Jev text context exceeds its budget. Start a shorter request.")
}
