import { useEffect, useId, useRef, useState } from "react"

export function ConstructionPlanes() {
  return (
    <div className="construction-planes" aria-hidden="true">
      <div className="construction-plane construction-plane-floor" />
      <div className="construction-plane construction-plane-upright" />
      <div className="construction-plane construction-plane-cross" />
      <div className="construction-orbit" />
    </div>
  )
}

export function PrintVisual() {
  const clipId = useId()
  const sceneRef = useRef<HTMLDivElement>(null)
  const [started, setStarted] = useState(false)
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setStarted(true)
        observer.disconnect()
      },
      { threshold: 0.35 },
    )
    observer.observe(scene)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={sceneRef} className="print-visual" data-started={started} aria-hidden="true">
      <svg viewBox="0 0 560 420" fill="none" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <rect className="print-reveal" x="170" y="200" width="220" height="140" />
          </clipPath>
        </defs>
        <g className="print-construction" stroke="currentColor" strokeWidth="0.7">
          <path d="M56 289 280 177 504 289 280 401Z M280 177V48 M56 289V160L280 48 504 160V289 M56 160 280 272 504 160 M280 272V401" />
          <path
            strokeDasharray="3 7"
            d="m112 261 224 112m-168-140 224 112m-168-140 224 112m-112-112-224 112m168-140-224 112m112-112-224 112"
          />
          <circle cx="280" cy="289" r="5" />
        </g>
        <path className="print-bed-edge" d="m96 282 184 92 184-92v12l-184 92-184-92Z" />
        <path className="print-bed" d="m96 282 184-92 184 92-184 92Z" />
        <g className="print-bed-grid" stroke="currentColor" strokeWidth="0.6">
          <path d="m142 259 184 92m-138-115 184 92m-138-115 184 92m0-46-184 92m138-115-184 92m138-115-184 92" />
        </g>
        <g clipPath={`url(#${clipId})`}>
          {Array.from({ length: 17 }, (_, layer) => (
            <path
              key={`layer-${layer.toString()}`}
              className="printed-layer"
              transform={`translate(0 ${-layer * 4.5})`}
              fillRule="evenodd"
              d="m196 286 70-35q14-7 28 0l70 35q14 7 0 14l-70 35q-14 7-28 0l-70-35q-14-7 0-14Zm31 7 53 26 53-26-53-26Z"
            />
          ))}
        </g>
        <g className="print-elevator">
          <path className="print-rail" d="m144 137 200 100 72-36-200-100Z" />
          <path
            className="print-rail-edge"
            d="m144 137 200 100v9L144 146Zm200 100 72-36v9l-72 36Z"
          />
          <g className="print-carriage">
            <path className="print-head-top" d="m251 159 29-15 29 15-29 15Z" />
            <path className="print-head-left" d="m251 159 29 15v38l-29-15Z" />
            <path className="print-head-right" d="m280 174 29-15v38l-29 15Z" />
            <path className="print-nozzle" d="m270 207 10 5 10-5-10 15Z" />
            <path className="print-filament" d="M280 222v5" />
            <path className="print-head-vent" d="m258 171 14 7m-14 0 14 7m-14 0 14 7" />
          </g>
        </g>
        <g className="print-registration" stroke="currentColor">
          <path d="M70 325v12h24m372 0h24v-12M266 56h28m-14-14v28" />
          <circle cx="280" cy="386" r="3" />
        </g>
      </svg>
    </div>
  )
}
