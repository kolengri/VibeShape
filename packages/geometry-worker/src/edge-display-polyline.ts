import { type Edge, getOC } from "replicad"

type Point = [number, number, number]

/** Bounded display approximation; exact modeling uses the native edge, never these samples. */
export function edgeDisplayPolyline(edge: Edge, maximumPoints = 1025): Point[] | undefined {
  if (!Number.isInteger(maximumPoints) || maximumPoints < 2) return undefined
  const pointBudget = Math.min(1025, maximumPoints)
  const oc = getOC()
  const adaptor = new oc.BRepAdaptor_Curve_2(edge.wrapped)
  try {
    const first = adaptor.FirstParameter()
    const last = adaptor.LastParameter()
    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return undefined
    const pointAt = (parameter: number): Point => {
      const point = adaptor.Value(parameter)
      try {
        const coordinates: Point = [point.X(), point.Y(), point.Z()]
        if (!coordinates.every(Number.isFinite)) throw new Error("Invalid edge display coordinate.")
        return coordinates
      } finally {
        point.delete()
      }
    }
    const result: Point[] = [pointAt(first)]
    const intervals = 16
    let start = result[0] as Point
    for (let index = 1; index <= intervals; index += 1) {
      const from = first + ((last - first) * (index - 1)) / intervals
      const to = first + ((last - first) * index) / intervals
      const end = pointAt(to)
      if (!appendInterval(pointAt, from, to, start, end, result, 0, pointBudget)) return undefined
      start = end
    }
    return result
  } catch {
    return undefined
  } finally {
    adaptor.delete()
  }
}

function appendInterval(
  pointAt: (parameter: number) => Point,
  from: number,
  to: number,
  start: Point,
  end: Point,
  result: Point[],
  depth: number,
  maximumPoints: number,
): boolean {
  if (result.length >= maximumPoints) return false
  const middleParameter = (from + to) / 2
  const middle = pointAt(middleParameter)
  const deviation = Math.hypot(
    middle[0] - (start[0] + end[0]) / 2,
    middle[1] - (start[1] + end[1]) / 2,
    middle[2] - (start[2] + end[2]) / 2,
  )
  if (deviation <= 0.025) {
    result.push(end)
    return true
  }
  if (depth >= 6) return false
  return (
    appendInterval(
      pointAt,
      from,
      middleParameter,
      start,
      middle,
      result,
      depth + 1,
      maximumPoints,
    ) && appendInterval(pointAt, middleParameter, to, middle, end, result, depth + 1, maximumPoints)
  )
}
