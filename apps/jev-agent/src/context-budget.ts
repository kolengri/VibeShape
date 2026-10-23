import type { DecisionState, Observation } from "./contracts"
import { JevFailure } from "./failure"

type SessionContext = NonNullable<DecisionState["session"]>
const requestMarker = "\n[Earlier request text truncated.]\n"
const serializedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const contextBytes = (state: DecisionState) => serializedBytes({ ...state, photos: [] })

function requestExcerpt(text: string, budget: number) {
  if (serializedBytes(text) <= budget) return text
  const characters = Array.from(text)
  const excerpt = (length: number) =>
    characters.slice(0, length).join("") +
    requestMarker +
    characters.slice(characters.length - length).join("")
  let low = 0
  let high = Math.floor(characters.length / 2)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (serializedBytes(excerpt(middle)) <= budget) low = middle
    else high = middle - 1
  }
  return excerpt(low)
}

function omitRequest(session: SessionContext) {
  session.requests.splice(1, 1)
  session.omittedRequests = (session.omittedRequests ?? 0) + 1
}

export function retainRequest(session: SessionContext, goal: string) {
  session.requests.push(requestExcerpt(goal, 8000))
  while (session.requests.length > 2 && serializedBytes(session.requests) > 24_000)
    omitRequest(session)
}

function compactRequests(state: DecisionState) {
  const session = state.session
  if (!session?.requests.length) return
  while (session.requests.length > 2 && contextBytes(state) > 64_000) omitRequest(session)
  const available = serializedBytes(session.requests) - (contextBytes(state) - 64_000)
  const budget = Math.floor((available - session.requests.length - 1) / session.requests.length)
  if (budget < serializedBytes(requestMarker)) return
  session.requests = session.requests.map((request) => requestExcerpt(request, budget))
}

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
  while (session.answeredQuestions.length > 0 && contextBytes(state) > 64_000) {
    session.answeredQuestions.shift()
    session.omittedAnsweredQuestions = (session.omittedAnsweredQuestions ?? 0) + 1
  }
}

export function boundContext(state: DecisionState) {
  const bytes = () => contextBytes(state)
  while (state.history.length > 1 && bytes() > 64_000) state.history.shift()
  if (bytes() > 64_000) compactAnswers(state)
  if (bytes() > 64_000) compactRequests(state)
  if (bytes() > 64_000)
    throw new JevFailure("The Jev text context exceeds its budget. Start a shorter request.")
}
