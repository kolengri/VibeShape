import type { DrawingSettings } from "@vibeshape/domain/drawing"
import type { DrawingViewId } from "@vibeshape/protocol"

export type SheetPoint = readonly [number, number]

/** Line conventions; writers map each layer to an ISO 128 line type and width. */
export type SheetLayer = "visible" | "hidden" | "dimension" | "title" | "frame"

export type SheetPrimitive =
  | Readonly<{ kind: "line"; layer: SheetLayer; start: SheetPoint; end: SheetPoint }>
  | Readonly<{ kind: "circle"; layer: SheetLayer; center: SheetPoint; radius: number }>
  | Readonly<{
      kind: "arc"
      layer: SheetLayer
      center: SheetPoint
      radius: number
      /** Counter-clockwise radians in sheet coordinates. */
      startAngle: number
      endAngle: number
    }>
  | Readonly<{ kind: "polyline"; layer: SheetLayer; points: readonly SheetPoint[] }>
  | Readonly<{
      kind: "arrow"
      layer: SheetLayer
      points: readonly [SheetPoint, SheetPoint, SheetPoint]
    }>
  | Readonly<{
      kind: "text"
      layer: SheetLayer
      position: SheetPoint
      height: number
      text: string
      align: "start" | "middle" | "end"
      rotation: 0 | 90
    }>

export type SheetGroup = Readonly<{ id: string; primitives: readonly SheetPrimitive[] }>

export type PlacedView = Readonly<{
  view: DrawingViewId
  x: number
  y: number
  width: number
  height: number
}>

/** One composed sheet in millimetres with a bottom-left origin and Y up. */
export type DrawingSheet = Readonly<{
  width: number
  height: number
  title: string
  scale: Readonly<{ numerator: number; denominator: number }>
  /** False when an explicit scale makes the views exceed the drawing area. */
  fits: boolean
  /** Diameter callouts omitted because no position kept every label readable. */
  omittedCallouts: number
  views: readonly PlacedView[]
  groups: readonly SheetGroup[]
}>

/** Localized text placed on the sheet; display copy is supplied by the host. */
export type DrawingSheetCopy = Readonly<{
  viewLabels: Readonly<Record<DrawingViewId, string>>
  captions: Readonly<{
    title: string
    drawingNumber: string
    author: string
    date: string
    material: string
    scale: string
    units: string
    projection: string
    sheet: string
  }>
  projections: Readonly<Record<DrawingSettings["projection"], string>>
  units: Readonly<Record<DrawingSettings["units"], string>>
}>

/** Fixed decimal text for every writer; identical input therefore yields identical bytes. */
export function sheetNumber(value: number, digits = 4) {
  const text = value.toFixed(digits).replace(/\.?0+$/, "")
  return text === "-0" ? "0" : text
}

/** One serializer per primitive kind; writers stay flat instead of branching on every kind. */
export type PrimitiveWriters<T> = {
  readonly [K in SheetPrimitive["kind"]]: (item: Extract<SheetPrimitive, { kind: K }>) => T
}

export function writePrimitive<T>(writers: PrimitiveWriters<T>, item: SheetPrimitive): T {
  return (writers[item.kind] as (value: SheetPrimitive) => T)(item)
}

export function pointOnCircle(center: SheetPoint, radius: number, angle: number): SheetPoint {
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]
}
