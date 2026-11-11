import {
  type DrawingSettings,
  drawingSheetExtent,
  stripDrawingControlCharacters,
} from "@vibeshape/domain/drawing"
import type { DrawingCurve, DrawingProjection } from "@vibeshape/protocol"
import { diameterCallouts, overallDimensions, TEXT_HEIGHT_MM } from "./annotations"
import {
  type AnnotationMargins,
  layoutViews,
  SHEET_BORDER_MM,
  TITLE_BLOCK_HEIGHT_MM,
  TITLE_BLOCK_WIDTH_MM,
  type ViewPlacement,
} from "./layout"
import type {
  DrawingSheet,
  DrawingSheetCopy,
  SheetGroup,
  SheetLayer,
  SheetPrimitive,
} from "./sheet"
import { primitiveBox, unionBoxes } from "./text-metrics"
import { titleBlock } from "./title-block"

const TITLE_BLOCK_CLEARANCE_MM = 4
const LABEL_OFFSET_MM = 6
const DIMENSIONED_LABEL_OFFSET_MM = 18

export type ComposeDrawingInput = Readonly<{
  projection: DrawingProjection
  settings: DrawingSettings
  copy: DrawingSheetCopy
  /** Fallback when the title block leaves the title empty, normally the document name. */
  documentTitle: string
}>

/**
 * Lays out projected views on one sheet with frame, title block, overall dimensions and diameter
 * callouts. Pure and deterministic; every writer renders the same sheet.
 */
export function composeDrawingSheet(input: ComposeDrawingInput): DrawingSheet {
  const text = stripDrawingControlCharacters
  // Every string that reaches the sheet passes this boundary once: the document name (validated
  // by a schema that allows control characters), title fields and host copy.
  const fields = Object.fromEntries(
    Object.entries(input.settings.titleBlock).map(([key, value]) => [key, text(value)]),
  ) as DrawingSettings["titleBlock"]
  const settings = {
    ...input.settings,
    titleBlock: { ...fields, title: fields.title || text(input.documentTitle).trim() },
  }
  const copy = sanitizedCopy(input.copy)
  const { width, height } = drawingSheetExtent(settings)
  const inner = {
    x: SHEET_BORDER_MM,
    y: SHEET_BORDER_MM,
    width: width - 2 * SHEET_BORDER_MM,
    height: height - 2 * SHEET_BORDER_MM,
  }
  const reserved = TITLE_BLOCK_HEIGHT_MM + TITLE_BLOCK_CLEARANCE_MM
  const area = {
    x: inner.x,
    y: inner.y + reserved,
    width: inner.width,
    height: inner.height - reserved,
  }
  const requested = new Set(settings.views)
  const views = input.projection.views.filter(({ view }) => requested.has(view))
  const annotate = (placement: ViewPlacement, factor: number) =>
    viewAnnotations(placement, settings, copy, factor)
  const layout = layoutViews(views, settings, area, (projection, orthographic, factor) =>
    measureAnnotations(projection, orthographic, factor, annotate),
  )
  const factor = layout.scale.numerator / layout.scale.denominator
  const scaleText = `${layout.scale.numerator}:${layout.scale.denominator}`
  const groups: SheetGroup[] = [
    {
      id: "frame",
      primitives: [
        {
          kind: "polyline",
          layer: "frame",
          points: [
            [inner.x, inner.y],
            [inner.x + inner.width, inner.y],
            [inner.x + inner.width, inner.y + inner.height],
            [inner.x, inner.y + inner.height],
            [inner.x, inner.y],
          ],
        },
      ],
    },
    ...layout.placements.map((placement) => ({
      id: `view-${placement.projection.view}`,
      primitives: viewPrimitives(placement, factor, settings.hiddenLines),
    })),
    {
      id: "dimensions",
      primitives: layout.placements.flatMap((placement) => annotate(placement, factor).dimensions),
    },
    {
      id: "labels",
      primitives: layout.placements.map((placement) => annotate(placement, factor).label),
    },
    {
      id: "title-block",
      primitives: titleBlock({
        origin: [inner.x + inner.width - TITLE_BLOCK_WIDTH_MM, inner.y],
        settings,
        copy,
        scaleText,
      }),
    },
  ]
  return {
    width,
    height,
    title: settings.titleBlock.title,
    omittedCallouts: layout.placements.reduce(
      (sum, placement) => sum + annotate(placement, factor).omitted,
      0,
    ),
    scale: layout.scale,
    fits: layout.fits,
    views: layout.placements.map(({ projection, rect }) => ({ view: projection.view, ...rect })),
    groups,
  }
}

/** Isometric views omit hidden lines by convention, matching common pictorial practice. */
function viewPrimitives(
  placement: ViewPlacement,
  factor: number,
  hiddenLines: boolean,
): SheetPrimitive[] {
  const showHidden = hiddenLines && placement.orthographic
  const map = (point: readonly [number, number]) =>
    [placement.origin[0] + point[0] * factor, placement.origin[1] + point[1] * factor] as const
  return placement.projection.edges.flatMap((edge) => {
    if (edge.visibility === "hidden" && !showHidden) return []
    return [sheetCurve(edge.curve, edge.visibility, map, factor)]
  })
}

function sheetCurve(
  curve: DrawingCurve,
  layer: SheetLayer,
  map: (point: readonly [number, number]) => readonly [number, number],
  factor: number,
): SheetPrimitive {
  if (curve.kind === "line")
    return { kind: "line", layer, start: map(curve.start), end: map(curve.end) }
  if (curve.kind === "polyline") return { kind: "polyline", layer, points: curve.points.map(map) }
  if (curve.kind === "circle")
    return { kind: "circle", layer, center: map(curve.center), radius: curve.radius * factor }
  return {
    kind: "arc",
    layer,
    center: map(curve.center),
    radius: curve.radius * factor,
    startAngle: curve.startAngle,
    endAngle: curve.endAngle,
  }
}

type ViewAnnotations = Readonly<{
  dimensions: SheetPrimitive[]
  label: SheetPrimitive
  /** Diameter callouts left out because no readable position was free. */
  omitted: number
}>

/**
 * The dimensions, callouts and label drawn for one placed view; also used to measure margins.
 * Callouts are placed last, around the overall dimensions and the label.
 */
function viewAnnotations(
  placement: ViewPlacement,
  settings: DrawingSettings,
  copy: DrawingSheetCopy,
  factor: number,
): ViewAnnotations {
  const label = viewLabel(placement, settings, copy)
  if (!settings.dimensions || !placement.orthographic) return { dimensions: [], label, omitted: 0 }
  const overall = overallDimensions(placement, settings.units)
  const callouts = diameterCallouts(
    placement,
    settings.units,
    factor,
    [...overall, label].map(primitiveBox),
  )
  return { dimensions: [...overall, ...callouts.primitives], label, omitted: callouts.omitted }
}

/**
 * Margins of a view's annotations beyond its rectangle, measured on a provisional placement with
 * the rectangle at the sheet origin. Annotations are positioned relative to the rectangle, so the
 * margins hold wherever the layout later places the view.
 */
function measureAnnotations(
  projection: ViewPlacement["projection"],
  orthographic: boolean,
  factor: number,
  annotate: (placement: ViewPlacement, factor: number) => ViewAnnotations,
): AnnotationMargins {
  const { min, max } = projection.bounds
  const width = (max[0] - min[0]) * factor
  const height = (max[1] - min[1]) * factor
  const placement: ViewPlacement = {
    projection,
    orthographic,
    origin: [-min[0] * factor, -min[1] * factor],
    rect: { x: 0, y: 0, width, height },
  }
  const { dimensions, label } = annotate(placement, factor)
  const box = unionBoxes([...dimensions, label].map(primitiveBox))
  if (!box) return { left: 0, right: 0, bottom: 0, top: 0 }
  return {
    left: Math.max(0, -box[0]),
    bottom: Math.max(0, -box[1]),
    right: Math.max(0, box[2] - width),
    top: Math.max(0, box[3] - height),
  }
}

function viewLabel(
  placement: ViewPlacement,
  settings: DrawingSettings,
  copy: DrawingSheetCopy,
): SheetPrimitive {
  const offset =
    settings.dimensions && placement.orthographic ? DIMENSIONED_LABEL_OFFSET_MM : LABEL_OFFSET_MM
  return {
    kind: "text",
    layer: "dimension",
    position: [
      placement.rect.x + placement.rect.width / 2,
      placement.rect.y - offset - TEXT_HEIGHT_MM / 2,
    ],
    height: TEXT_HEIGHT_MM,
    text: copy.viewLabels[placement.projection.view],
    align: "middle",
    rotation: 0,
  }
}

/** Host copy is trusted catalog text, but it is sanitized with the same rule as user fields. */
function sanitizedCopy(copy: DrawingSheetCopy): DrawingSheetCopy {
  const clean = <T extends Readonly<Record<string, string>>>(record: T): T =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, stripDrawingControlCharacters(value)]),
    ) as T
  return {
    viewLabels: clean(copy.viewLabels),
    captions: clean(copy.captions),
    projections: clean(copy.projections),
    units: clean(copy.units),
  }
}
