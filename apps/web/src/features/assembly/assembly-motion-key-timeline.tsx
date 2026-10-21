import { cn } from "@vibeshape/ui/lib/cn"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

type MotionKey = { time: number; value: number }
type TimelineProps = {
  keys: readonly MotionKey[]
  duration: number
  disabled: boolean
  label: string
  keyLabel: (index: number, time: number) => string
  onChange: (keys: MotionKey[]) => void
}
type PointerDrag = {
  index: number
  pointerId: number
  target: HTMLButtonElement
  keys: readonly MotionKey[]
  duration: number
  startX: number
  width: number
  time: number
}
type PointerStart = Omit<PointerDrag, "keys" | "duration" | "time">

function validTimeline(keys: readonly MotionKey[], duration: number) {
  return (
    Number.isFinite(duration) &&
    duration > 0 &&
    keys.every(
      (key, index) =>
        Number.isFinite(key.time) &&
        Number.isFinite(key.value) &&
        key.time >= 0 &&
        key.time <= duration &&
        (index === 0 || key.time > (keys[index - 1]?.time ?? 0)),
    )
  )
}

function timeBounds(keys: readonly MotionKey[], index: number, duration: number) {
  const current = keys[index]?.time ?? 0
  const before = keys[index - 1]?.time
  const after = keys[index + 1]?.time
  // Practical separation avoids subnormal times on Home/End; retain tighter authored intervals.
  const gap = (time: number) =>
    Math.max(duration / 1_000_000, time * Number.EPSILON, Number.MIN_VALUE)
  return {
    min: before === undefined ? 0 : Math.min(current, before + gap(before)),
    max: after === undefined ? duration : Math.max(current, after - gap(after)),
  }
}

function pointerTime(drag: PointerDrag, clientX: number) {
  const { min, max } = timeBounds(drag.keys, drag.index, drag.duration)
  const startTime = drag.keys[drag.index]?.time ?? 0
  return Math.max(
    min,
    Math.min(max, startTime + ((clientX - drag.startX) / drag.width) * drag.duration),
  )
}

function keyboardTime(key: string, time: number, step: number, min: number, max: number) {
  switch (key) {
    case "ArrowLeft":
      return Math.max(min, time - step)
    case "ArrowRight":
      return Math.min(max, time + step)
    case "Home":
      return min
    case "End":
      return max
    default:
      return undefined
  }
}

function keyboardStep(event: KeyboardEvent, duration: number) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return undefined
  return duration / (event.shiftKey ? 10 : 100)
}

function laneWidth(lane: HTMLDivElement | null) {
  const width = lane?.getBoundingClientRect().width ?? 0
  return Number.isFinite(width) && width > 0 ? width : 0
}

function matchesTimeline(drag: PointerDrag, keys: readonly MotionKey[], duration: number) {
  return (
    duration === drag.duration &&
    keys.length === drag.keys.length &&
    keys.every((key, index) => {
      const original = drag.keys[index]
      return original !== undefined && key.time === original.time && key.value === original.value
    })
  )
}

export function AssemblyMotionKeyTimeline({
  keys,
  duration,
  disabled,
  label,
  keyLabel,
  onChange,
}: TimelineProps) {
  const lane = useRef<HTMLDivElement>(null)
  const pointerDrag = useRef<PointerDrag | null>(null)
  const [pointerStart, setPointerStart] = useState<PointerStart | null>(null)
  const [preview, setPreview] = useState<PointerDrag | null>(null)
  const valid = validTimeline(keys, duration)
  const enabled = valid && !disabled
  const isCurrent = (drag: PointerDrag) => enabled && matchesTimeline(drag, keys, duration)
  const activePreview = preview && isCurrent(preview) ? preview : null
  const displayedTime = (key: MotionKey, index: number) =>
    activePreview?.index === index ? activePreview.time : key.time
  const changeTime = (index: number, time: number) => {
    if (!enabled || !Number.isFinite(time) || keys[index]?.time === time) return
    const { min, max } = timeBounds(keys, index, duration)
    if (time < min || time > max) return
    onChange(keys.map((key, keyIndex) => (keyIndex === index ? { ...key, time } : key)))
  }
  const cancelDrag = useCallback(() => {
    const drag = pointerDrag.current
    pointerDrag.current = null
    setPreview(null)
    if (drag?.target.hasPointerCapture?.(drag.pointerId))
      drag.target.releasePointerCapture(drag.pointerId)
  }, [])
  useLayoutEffect(() => {
    if (!pointerStart) return
    setPointerStart(null)
    const key = keys[pointerStart.index]
    if (!enabled || !key) {
      if (pointerStart.target.hasPointerCapture?.(pointerStart.pointerId))
        pointerStart.target.releasePointerCapture(pointerStart.pointerId)
      return
    }
    // Focusing a marker commits a buffered numeric field in the same event.
    // Snapshot after that render so the new drag includes the committed edit.
    const drag = {
      ...pointerStart,
      keys: keys.map((item) => ({ ...item })),
      duration,
      time: key.time,
    }
    pointerDrag.current = drag
    setPreview(drag)
  }, [pointerStart, enabled, keys, duration])
  useEffect(() => {
    const drag = pointerDrag.current
    if (drag && (!enabled || !matchesTimeline(drag, keys, duration))) cancelDrag()
  }, [enabled, keys, duration, cancelDrag])
  const first = keys[0]
  const last = keys.at(-1)

  return (
    <fieldset aria-label={label} disabled={!enabled} className="min-w-0 w-full">
      <div ref={lane} className="relative mx-3 h-8">
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {valid && first && last && (
          <div
            aria-hidden="true"
            className="absolute top-1/2 h-px bg-primary"
            style={{
              left: `${(displayedTime(first, 0) / duration) * 100}%`,
              width: `${((displayedTime(last, keys.length - 1) - displayedTime(first, 0)) / duration) * 100}%`,
            }}
          />
        )}
        {valid &&
          keys.map((key, index) => {
            const time = displayedTime(key, index)
            const bounds = timeBounds(keys, index, duration)
            return (
              <button
                key={index}
                type="button"
                role="slider"
                aria-label={keyLabel(index, time)}
                aria-orientation="horizontal"
                aria-valuemin={bounds.min}
                aria-valuemax={bounds.max}
                aria-valuenow={time}
                title={keyLabel(index, time)}
                disabled={!enabled}
                className={cn(
                  "absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm",
                  "touch-none select-none text-primary outline-none hover:bg-muted",
                  "focus:z-10 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                )}
                style={{ left: `${(time / duration) * 100}%` }}
                onClick={(event) => event.stopPropagation()}
                onKeyUp={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    if (pointerDrag.current) {
                      event.preventDefault()
                      event.stopPropagation()
                      cancelDrag()
                    }
                    return
                  }
                  event.stopPropagation()
                  const step = keyboardStep(event.nativeEvent, duration)
                  if (step === undefined) return
                  const next = keyboardTime(event.key, time, step, bounds.min, bounds.max)
                  if (next === undefined) return
                  event.preventDefault()
                  if (!pointerDrag.current) changeTime(index, next)
                }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  if (
                    !enabled ||
                    event.button !== 0 ||
                    event.isPrimary === false ||
                    pointerDrag.current ||
                    !Number.isFinite(event.clientX)
                  )
                    return
                  const width = laneWidth(lane.current)
                  if (!width) return
                  event.preventDefault()
                  event.currentTarget.focus()
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  setPointerStart({
                    index,
                    pointerId: event.pointerId,
                    target: event.currentTarget,
                    startX: event.clientX,
                    width,
                  })
                }}
                onPointerMove={(event) => {
                  event.stopPropagation()
                  const drag = pointerDrag.current
                  if (!drag || drag.pointerId !== event.pointerId) return
                  if (!isCurrent(drag)) return cancelDrag()
                  if (!Number.isFinite(event.clientX)) return
                  const next = { ...drag, time: pointerTime(drag, event.clientX) }
                  pointerDrag.current = next
                  setPreview(next)
                }}
                onPointerUp={(event) => {
                  event.stopPropagation()
                  const drag = pointerDrag.current
                  if (!drag || drag.pointerId !== event.pointerId) return
                  const time = Number.isFinite(event.clientX)
                    ? pointerTime(drag, event.clientX)
                    : drag.time
                  cancelDrag()
                  if (isCurrent(drag)) changeTime(drag.index, time)
                }}
                onPointerCancel={(event) => {
                  event.stopPropagation()
                  if (pointerDrag.current?.pointerId === event.pointerId) cancelDrag()
                }}
                onLostPointerCapture={(event) => {
                  if (pointerDrag.current?.pointerId === event.pointerId) cancelDrag()
                }}
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rotate-45 border border-primary bg-background"
                />
              </button>
            )
          })}
      </div>
      {valid && (
        <div
          aria-hidden="true"
          className="flex min-w-0 justify-between gap-2 text-xs tabular-nums text-muted-foreground"
        >
          <span>0</span>
          <span className="min-w-0 break-all text-right">{duration}</span>
        </div>
      )}
    </fieldset>
  )
}
