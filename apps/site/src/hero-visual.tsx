import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react"

const motionQuery = "(prefers-reduced-motion: reduce)"
const getReducedMotion = () => window.matchMedia(motionQuery).matches
const getServerMotion = () => true
const subscribeToMotion = (notify: () => void) => {
  const query = window.matchMedia(motionQuery)
  query.addEventListener("change", notify)
  return () => query.removeEventListener("change", notify)
}

function useVideoVisibility(ref: RefObject<HTMLVideoElement | null>) {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    let visible = false
    const update = () => setActive(visible && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      update()
    })
    observer.observe(video)
    document.addEventListener("visibilitychange", update)
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", update)
    }
  }, [ref])
  return active
}

function floatModel(video: HTMLVideoElement) {
  let frame = 0
  const started = performance.now()
  const update = (now: number) => {
    // Keep the exploded assembly around its four-second reference pose.
    const time = 4 + 0.35 * Math.sin(((now - started) / 8000) * Math.PI * 2)
    if (!video.seeking && Math.abs(video.currentTime - time) > 1 / 60) {
      video.currentTime = time
    }
    frame = requestAnimationFrame(update)
  }
  frame = requestAnimationFrame(update)
  return () => cancelAnimationFrame(frame)
}

function PlaybackVideo({ source }: { source: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [phase, setPhase] = useState<"intro" | "floating">("intro")
  const active = useVideoVisibility(videoRef) && !failed

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    if (active && phase === "intro") {
      void video.play().catch(() => {
        if (!cancelled) setFailed(true)
      })
    } else {
      video.pause()
    }
    return () => {
      cancelled = true
      video.pause()
    }
  }, [active, phase])

  useEffect(() => {
    const video = videoRef.current
    if (video && active && phase === "floating") return floatModel(video)
  }, [active, phase])

  if (failed) return null
  return (
    <video
      ref={videoRef}
      src={source}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      data-phase={phase}
      data-active={active}
      onLoadedData={() => setReady(true)}
      onEnded={() => setPhase("floating")}
      onError={() => setFailed(true)}
      className={`hero-playback absolute inset-0 size-full object-cover ${ready ? "opacity-100" : "opacity-0"}`}
    />
  )
}

export function HeroVisual({
  source,
  poster,
  description,
}: {
  source: string
  poster: string
  description: string
}) {
  const reducedMotion = useSyncExternalStore(subscribeToMotion, getReducedMotion, getServerMotion)
  return (
    <div className="hero-visual relative aspect-square overflow-hidden">
      <img
        src={poster}
        alt={description}
        width="960"
        height="960"
        fetchPriority="high"
        className="size-full object-cover"
      />
      {!reducedMotion && <PlaybackVideo source={source} />}
    </div>
  )
}
