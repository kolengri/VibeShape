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

function PlaybackVideo({
  source,
  loopSource,
  poster,
}: {
  source: string
  loopSource: string
  poster: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [phase, setPhase] = useState<"intro" | "floating">("intro")
  const active = useVideoVisibility(videoRef) && !failed

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    if (active) {
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

  if (failed) return null
  return (
    <video
      ref={videoRef}
      src={phase === "intro" ? source : loopSource}
      poster={poster}
      loop={phase === "floating"}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      data-phase={phase}
      data-active={active}
      data-ready={ready}
      onLoadedData={() => setReady(true)}
      onEnded={() => {
        setReady(false)
        setPhase("floating")
      }}
      onError={() => setFailed(true)}
      className="hero-playback absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-300 data-[ready=true]:opacity-100"
    />
  )
}

export function HeroVisual({
  source,
  loopSource,
  poster,
  description,
}: {
  source: string
  loopSource: string
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
      {!reducedMotion && <PlaybackVideo source={source} loopSource={loopSource} poster={poster} />}
    </div>
  )
}
