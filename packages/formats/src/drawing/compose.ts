import { type DrawingSettings, drawingSheetExtent } from "@vibeshape/domain/drawing"
import type { DrawingCurve, DrawingProjection } from "@vibeshape/protocol"
import { diameterCallouts, overallDimensions, TEXT_HEIGHT_MM } from "./annotations"
import {
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
  const settings = {
    ...input.settings,
    titleBlock: {
      ...input.settings.titleBlock,
      title: input.settings.titleBlock.title || input.documentTitle,
    },
  }
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
  const layout = layoutViews(views, settings, area)
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
      primitives: layout.placements.flatMap((placement) =>
        settings.dimensions && placement.orthographic
          ? [
              ...overallDimensions(placement, settings.units),
              ...diameterCallouts(placement, settings.units, factor),
            ]
          : [],
      ),
    },
    {
      id: "labels",
      primitives: layout.placements.map((placement) => viewLabel(placement, settings, input.copy)),
    },
    {
      id: "title-block",
      primitives: titleBlock({
        origin: [inner.x + inner.width - TITLE_BLOCK_WIDTH_MM, inner.y],
        settings,
        copy: input.copy,
        scaleText,
      }),
    },
  ]
  return {
    width,
    height,
    title: settings.titleBlock.title,
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
