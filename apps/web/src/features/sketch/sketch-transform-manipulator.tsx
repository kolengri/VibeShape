import type { SketchEntityTransform, SketchPoint2 } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import type { PointerEvent } from "react"

export type SketchTransformHandle = "move" | "move-x" | "move-y" | "rotate" | "scale"

export type SketchTransformPreview = Readonly<{
  rotationRadians: number
  scale: number
  translation: SketchPoint2
}>

export type SketchTransformGesture = Readonly<{
  base: SketchTransformPreview
  center: SketchPoint2
  handle: SketchTransformHandle
  pointerId: number
  start: SketchPoint2
}>

export const identitySketchTransform: SketchTransformPreview = {
  rotationRadians: 0,
  scale: 1,
  translation: { x: 0, y: 0 },
}

const MIN_SCALE = 0.01
const SNAP_ROTATION_RADIANS = Math.PI / 12
const SNAP_SCALE_STEP = 0.1

function pointerAngle(point: SketchPoint2, center: SketchPoint2) {
  return Math.atan2(point.y - center.y, point.x - center.x)
}

function pointerRadius(point: SketchPoint2, center: SketchPoint2) {
  return Math.hypot(point.x - center.x, point.y - center.y)
}

function snap(value: number, step: number) {
  return Math.round(value / step) * step
}

export function updateSketchTransformGesture(
  gesture: SketchTransformGesture,
  point: SketchPoint2,
  snapped: boolean,
): SketchTransformPreview {
  const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y }
  if (gesture.handle === "move" || gesture.handle === "move-x" || gesture.handle === "move-y") {
    return {
      ...gesture.base,
      translation: {
        x: gesture.base.translation.x + (gesture.handle === "move-y" ? 0 : delta.x),
        y: gesture.base.translation.y + (gesture.handle === "move-x" ? 0 : delta.y),
      },
    }
  }
  if (gesture.handle === "rotate") {
    const rotation =
      gesture.base.rotationRadians +
      pointerAngle(point, gesture.center) -
      pointerAngle(gesture.start, gesture.center)
    return {
      ...gesture.base,
      rotationRadians: snapped ? snap(rotation, SNAP_ROTATION_RADIANS) : rotation,
    }
  }
  const startRadius = pointerRadius(gesture.start, gesture.center)
  const factor =
    startRadius > Number.EPSILON ? pointerRadius(point, gesture.center) / startRadius : 1
  const scale = Math.max(MIN_SCALE, gesture.base.scale * factor)
  return {
    ...gesture.base,
    scale: snapped ? Math.max(MIN_SCALE, snap(scale, SNAP_SCALE_STEP)) : scale,
  }
}

export function sketchEntityTransformFromPreview(
  origin: SketchPoint2,
  preview: SketchTransformPreview,
): SketchEntityTransform {
  return {
    origin,
    rotationRadians: preview.rotationRadians,
    scale: preview.scale,
    translation: preview.translation,
  }
}

export function sketchTransformCenter(origin: SketchPoint2, preview: SketchTransformPreview) {
  return { x: origin.x + preview.translation.x, y: origin.y + preview.translation.y }
}

export function isIdentitySketchTransform(preview: SketchTransformPreview) {
  return (
    Math.abs(preview.rotationRadians) <= Number.EPSILON &&
    Math.abs(preview.scale - 1) <= Number.EPSILON &&
    Math.abs(preview.translation.x) <= Number.EPSILON &&
    Math.abs(preview.translation.y) <= Number.EPSILON
  )
}

export function updateSketchTransformFromKeyboard(
  preview: SketchTransformPreview,
  key: string,
  coarse: boolean,
): SketchTransformPreview | null {
  const translationStep = coarse ? 10 : 1
  const translations: Readonly<Record<string, SketchPoint2>> = {
    ArrowDown: { x: 0, y: -translationStep },
    ArrowLeft: { x: -translationStep, y: 0 },
    ArrowRight: { x: translationStep, y: 0 },
    ArrowUp: { x: 0, y: translationStep },
  }
  const translation = translations[key]
  if (translation) {
    return {
      ...preview,
      translation: {
        x: preview.translation.x + translation.x,
        y: preview.translation.y + translation.y,
      },
    }
  }
  if (key === "[" || key === "]") {
    return {
      ...preview,
      rotationRadians:
        preview.rotationRadians + (key === "]" ? SNAP_ROTATION_RADIANS : -SNAP_ROTATION_RADIANS),
    }
  }
  if (key === "-" || key === "=") {
    return {
      ...preview,
      scale: Math.max(
        MIN_SCALE,
        preview.scale + (key === "=" ? SNAP_SCALE_STEP : -SNAP_SCALE_STEP),
      ),
    }
  }
  return null
}

export function sketchTransformSvgValue(origin: SketchPoint2, preview: SketchTransformPreview) {
  const degrees = (preview.rotationRadians * 180) / Math.PI
  return `translate(${preview.translation.x} ${preview.translation.y}) translate(${origin.x} ${origin.y}) rotate(${degrees}) scale(${preview.scale}) translate(${-origin.x} ${-origin.y})`
}

export function SketchTransformManipulator({
  origin,
  preview,
  worldPerPixel,
  onStart,
}: Readonly<{
  origin: SketchPoint2
  preview: SketchTransformPreview
  worldPerPixel: number
  onStart: (event: PointerEvent<SVGElement>, handle: SketchTransformHandle) => void
}>) {
  const t = useTranslations("app.sketch.viewport")
  const center = sketchTransformCenter(origin, preview)
  const unit = Math.max(worldPerPixel, Number.EPSILON)
  const axisLength = unit * 46
  const ringRadius = unit * 31
  const hitWidth = 12
  const handleStart = (handle: SketchTransformHandle) => (event: PointerEvent<SVGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onStart(event, handle)
  }
  return (
    <g
      data-sketch-transform-manipulator
      transform={`scale(1 -1) translate(${center.x} ${center.y})`}
    >
      <circle
        className="cursor-alias fill-none stroke-sky-500"
        cx={0}
        cy={0}
        data-sketch-transform-handle="rotate"
        pointerEvents="stroke"
        r={ringRadius}
        strokeWidth={hitWidth}
        strokeOpacity={0.7}
        vectorEffect="non-scaling-stroke"
        onPointerDown={handleStart("rotate")}
      >
        <title>{t("transformRotate")}</title>
      </circle>
      <circle
        className="pointer-events-none fill-none stroke-background"
        cx={0}
        cy={0}
        r={ringRadius}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        className="pointer-events-none fill-none stroke-sky-500"
        cx={0}
        cy={0}
        r={ringRadius}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <line
        className="cursor-ew-resize stroke-red-500"
        data-sketch-transform-handle="move-x"
        pointerEvents="stroke"
        strokeWidth={hitWidth}
        x1={unit * 10}
        x2={axisLength}
        y1={0}
        y2={0}
        onPointerDown={handleStart("move-x")}
      >
        <title>{t("transformMoveX")}</title>
      </line>
      <path
        className="pointer-events-none fill-red-500"
        d={`M ${axisLength} 0 L ${axisLength - unit * 8} ${unit * 5} L ${axisLength - unit * 8} ${-unit * 5} Z`}
      />
      <line
        className="cursor-ns-resize stroke-emerald-500"
        data-sketch-transform-handle="move-y"
        pointerEvents="stroke"
        strokeWidth={hitWidth}
        x1={0}
        x2={0}
        y1={unit * 10}
        y2={axisLength}
        onPointerDown={handleStart("move-y")}
      >
        <title>{t("transformMoveY")}</title>
      </line>
      <path
        className="pointer-events-none fill-emerald-500"
        d={`M 0 ${axisLength} L ${unit * 5} ${axisLength - unit * 8} L ${-unit * 5} ${axisLength - unit * 8} Z`}
      />
      <rect
        className="cursor-nwse-resize fill-amber-400 stroke-background"
        data-sketch-transform-handle="scale"
        height={unit * 11}
        strokeWidth={2}
        transform={`translate(${ringRadius * 0.72} ${ringRadius * 0.72}) rotate(45)`}
        vectorEffect="non-scaling-stroke"
        width={unit * 11}
        x={-unit * 5.5}
        y={-unit * 5.5}
        onPointerDown={handleStart("scale")}
      >
        <title>{t("transformScale")}</title>
      </rect>
      <rect
        className="cursor-move fill-primary stroke-background"
        data-sketch-transform-handle="move"
        height={unit * 13}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        width={unit * 13}
        x={-unit * 6.5}
        y={-unit * 6.5}
        onPointerDown={handleStart("move")}
      >
        <title>{t("transformMove")}</title>
      </rect>
    </g>
  )
}
