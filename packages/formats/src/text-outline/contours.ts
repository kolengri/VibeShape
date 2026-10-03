/// <reference path="./upstream.d.ts" />
import { SKETCH_TEXT_MAX_POLES, SKETCH_TEXT_MAX_SEGMENTS } from "@vibeshape/domain/sketch-text"
import type { PathCommand } from "opentype.js/dist/opentype.mjs"
import { z } from "zod"
import type {
  SketchTextOutline,
  SketchTextOutlinePoint,
  SketchTextOutlineSegment,
} from "./contracts"
import { OutlineFailure } from "./failure"
import { elevateQuadratic } from "./geometry"

const finite = z.number().finite()
const pathCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("M"), x: finite, y: finite }).strict(),
  z.object({ type: z.literal("L"), x: finite, y: finite }).strict(),
  z.object({ type: z.literal("Q"), x1: finite, y1: finite, x: finite, y: finite }).strict(),
  z
    .object({
      type: z.literal("C"),
      x1: finite,
      y1: finite,
      x2: finite,
      y2: finite,
      x: finite,
      y: finite,
    })
    .strict(),
  z.object({ type: z.literal("Z") }).strict(),
])

export interface OutlineBudget {
  segmentCount: number
  poleCount: number
}

function appendSegment(
  segments: SketchTextOutlineSegment[],
  segment: SketchTextOutlineSegment,
  budget: OutlineBudget,
): void {
  const poles = segment.kind === "line" ? 2 : 4
  if (
    budget.segmentCount + 1 > SKETCH_TEXT_MAX_SEGMENTS ||
    budget.poleCount + poles > SKETCH_TEXT_MAX_POLES
  ) {
    throw new OutlineFailure(
      "outline-budget-exceeded",
      "Text contours exceed the 2,000-segment or 2,000-pole limit. Shorten the text.",
    )
  }
  budget.segmentCount += 1
  budget.poleCount += poles
  segments.push(segment)
}

type Command = z.infer<typeof pathCommandSchema>
type CurveCommand = Exclude<Command, { type: "M" | "Z" }>

class GlyphContourBuilder {
  readonly contours: SketchTextOutline["contours"] = []
  private segments: SketchTextOutlineSegment[] = []
  private start: SketchTextOutlinePoint | undefined
  private current: SketchTextOutlinePoint | undefined

  constructor(
    private readonly originX: number,
    private readonly scale: number,
    private readonly glyphOrdinal: number,
    private readonly budget: OutlineBudget,
  ) {}

  private point(x: number, y: number): SketchTextOutlinePoint {
    return [this.originX + x * this.scale || 0, y * this.scale || 0]
  }

  private fail(message: string): never {
    throw new OutlineFailure("invalid-font-outline", message, { glyphOrdinal: this.glyphOrdinal })
  }

  private closeContour(start: SketchTextOutlinePoint, current: SketchTextOutlinePoint): void {
    if (current[0] !== start[0] || current[1] !== start[1]) {
      appendSegment(this.segments, { kind: "line", start: current, end: start }, this.budget)
    }
    if (this.segments.length) {
      this.contours.push({
        glyphOrdinal: this.glyphOrdinal,
        contourOrdinal: this.contours.length,
        closed: true,
        segments: this.segments,
      })
    }
    this.segments = []
    this.start = undefined
    this.current = undefined
  }

  private appendCurve(command: CurveCommand, current: SketchTextOutlinePoint): void {
    const end = this.point(command.x, command.y)
    if (command.type === "L") {
      if (current[0] !== end[0] || current[1] !== end[1])
        appendSegment(this.segments, { kind: "line", start: current, end }, this.budget)
    } else if (command.type === "Q") {
      appendSegment(
        this.segments,
        elevateQuadratic(current, this.point(command.x1, command.y1), end),
        this.budget,
      )
    } else {
      appendSegment(
        this.segments,
        {
          kind: "cubic-bezier",
          start: current,
          control1: this.point(command.x1, command.y1),
          control2: this.point(command.x2, command.y2),
          end,
        },
        this.budget,
      )
    }
    this.current = end
  }

  consume(command: Command): void {
    if (command.type === "M") {
      if (this.start) this.fail("A font contour is missing its closing command.")
      this.start = this.point(command.x, command.y)
      this.current = this.start
      return
    }
    if (!this.start || !this.current) this.fail("A font contour command has no starting point.")
    if (command.type === "Z") {
      this.closeContour(this.start, this.current)
      return
    }
    this.appendCurve(command, this.current)
  }

  finish(): SketchTextOutline["contours"] {
    if (this.start) this.fail("A font contour is not closed.")
    return this.contours
  }
}

export function glyphContours(
  commands: readonly PathCommand[],
  originX: number,
  scale: number,
  glyphOrdinal: number,
  budget: OutlineBudget,
): SketchTextOutline["contours"] {
  const builder = new GlyphContourBuilder(originX, scale, glyphOrdinal, budget)
  for (const value of commands) {
    const parsed = pathCommandSchema.safeParse(value)
    if (!parsed.success)
      throw new OutlineFailure(
        "invalid-font-outline",
        "A font path command is unsupported or nonfinite.",
        { glyphOrdinal },
      )
    builder.consume(parsed.data)
  }
  return builder.finish()
}
