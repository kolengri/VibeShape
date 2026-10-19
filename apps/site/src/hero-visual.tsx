import { useEffect, useRef, useState, useSyncExternalStore } from "react"

const motionQuery = "(prefers-reduced-motion: reduce)"
const pinnedQuery = "(min-width: 1024px) and (min-height: 800px)"
const getReducedMotion = () => window.matchMedia(motionQuery).matches
const getServerMotion = () => true
const subscribeToMotion = (notify: () => void) => {
  const query = window.matchMedia(motionQuery)
  query.addEventListener("change", notify)
  return () => query.removeEventListener("change", notify)
}

function getPinnedProgress(video: HTMLVideoElement) {
  const section = video.closest<HTMLElement>(".hero-scroll-section")
  const frame = video.closest<HTMLElement>(".hero-scroll-frame")
  if (!section || !frame) return null
  const distance = section.offsetHeight - frame.offsetHeight
  if (distance <= 0) return null
  return (
    (Number.parseFloat(getComputedStyle(frame).top) - section.getBoundingClientRect().top) /
    distance
  )
}

function getScrollProgress(video: HTMLVideoElement) {
  if (window.matchMedia(pinnedQuery).matches) {
    const progress = getPinnedProgress(video)
    if (progress !== null) return progress
  }
  const bounds = video.getBoundingClientRect()
  return (window.innerHeight - bounds.top) / (window.innerHeight + bounds.height)
}

function ScrollVideo({ source }: { source: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let animationFrame = 0
    let lastRequestedTime = -1
    const update = () => {
      animationFrame = 0
      const progress = getScrollProgress(video)
      const time = Math.max(0, Math.min(1, progress)) * Math.max(0, video.duration - 1 / 30)
      if (video.seeking || !Number.isFinite(time)) return
      setReady(video.readyState >= 2)
      const nearestTime = Math.min(
        Math.abs(video.currentTime - time),
        Math.abs(lastRequestedTime - time),
      )
      if (nearestTime < 1 / 60) return
      lastRequestedTime = time
      video.currentTime = time
    }
    const schedule = () => {
      if (!animationFrame) animationFrame = requestAnimationFrame(update)
    }
    const showDecodedFrame = () => {
      setReady(true)
      schedule()
    }
    const resizeObserver = new ResizeObserver(schedule)
    for (const target of [
      video,
      video.closest(".hero-scroll-section"),
      video.closest(".hero-scroll-frame"),
    ]) {
      if (target) resizeObserver.observe(target)
    }
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    video.addEventListener("loadedmetadata", schedule)
    video.addEventListener("loadeddata", schedule)
    video.addEventListener("seeked", showDecodedFrame)
    schedule()

    return () => {
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      video.removeEventListener("loadedmetadata", schedule)
      video.removeEventListener("loadeddata", schedule)
      video.removeEventListener("seeked", showDecodedFrame)
    }
  }, [failed])

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
      onError={() => setFailed(true)}
      className={`absolute inset-0 size-full object-cover ${ready ? "opacity-100" : "opacity-0"}`}
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
        width="1280"
        height="1280"
        fetchPriority="high"
        className="size-full object-cover"
      />
      {!reducedMotion && <ScrollVideo source={source} />}
    </div>
  )
}
