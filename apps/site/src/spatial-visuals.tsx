import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react"

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

function useSceneStart() {
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
  return { sceneRef, started }
}

export function AnimatedScene({ children, className }: { children: ReactNode; className: string }) {
  const { sceneRef, started } = useSceneStart()
  return (
    <div ref={sceneRef} className={className} data-started={started}>
      {children}
    </div>
  )
}

export function PrintVisual() {
  return (
    <AnimatedScene className="print-visual">
      <svg viewBox="0 0 560 420" fill="none" aria-hidden="true">
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
        <g>
          {Array.from({ length: 17 }, (_, layer) => (
            <path
              key={`layer-${layer.toString()}`}
              className="printed-layer"
              style={{ "--layer": layer } as CSSProperties}
              transform={`translate(0 ${-layer * 4.5})`}
              fillRule="evenodd"
              d="m196 286 70-35q14-7 28 0l70 35q14 7 0 14l-70 35q-14 7-28 0l-70-35q-14-7 0-14Zm31 7 53 26 53-26-53-26Z"
            />
          ))}
        </g>
        <g className="print-elevator">
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
    </AnimatedScene>
  )
}

const featureGeometry = {
  sketch: (
    <>
      <path
        className="sketch-outline"
        d="M52 70V30Q52 22 60 22H160Q168 22 168 30V70Q168 78 160 78H60Q52 78 52 70Z"
        pathLength="1"
      />
      <circle className="sketch-hole" cx="110" cy="50" r="17" pathLength="1" />
      <path
        className="sketch-dimension"
        d="M52 12H168M52 8V16M168 8V16M44 22V78M40 22H48M40 78H48"
      />
    </>
  ),
  solid: (
    <>
      <path className="feature-guide" d="m62 61 48-24 48 24-48 24Z" />
      <g className="solid-body">
        <path className="feature-shade" d="m62 39 48 24 48-24v22l-48 24-48-24Z" />
        <path className="feature-face" d="m62 39 48-24 48 24-48 24Z" />
        <path d="M110 63V85" />
      </g>
    </>
  ),
  assembly: (
    <>
      <path className="feature-guide" strokeDasharray="3 4" d="M74 22V72M146 22V72" />
      <path className="feature-shade" d="m62 66 48-24 48 24v8l-48 24-48-24Z" />
      <path className="assembly-middle feature-face" d="m62 48 48-24 48 24-48 24Z" />
      <path className="assembly-top feature-face" d="m62 24 48-24 48 24-48 24Z" />
    </>
  ),
  print: (
    <>
      <path className="feature-guide" d="m56 70 54-27 54 27-54 27Z" />
      <path
        className="export-model feature-face"
        d="m86 36 24-12 24 12v24l-24 12-24-12Zm0 0 24 12 24-12m-24 12v24"
      />
      <path className="export-arrow" d="M176 24V64m-12-12 12 12 12-12M162 76H190" />
    </>
  ),
  privacy: (
    <>
      <path className="feature-face" d="M62 28H158L172 68V80H48V68Z" />
      <path d="M48 68H172M64 74H82" />
      <g className="privacy-lock">
        <rect className="feature-face" x="98" y="35" width="24" height="21" rx="3" />
        <path d="M103 35V28a7 7 0 0 1 14 0v7M110 43v5" />
      </g>
      <circle className="privacy-light" cx="156" cy="74" r="2" />
    </>
  ),
  agent: (
    <>
      <path className="feature-guide" d="M48 50H172" />
      <path className="agent-signal" d="M48 50H172" pathLength="1" />
      <rect className="feature-face" x="28" y="32" width="40" height="36" rx="6" />
      <path d="m40 43 7 7-7 7m11 0h8" />
      <path
        className="feature-face"
        d="m152 38 20-10 20 10v24l-20 10-20-10Zm0 0 20 10 20-10m-20 10v24"
      />
      <circle className="agent-node feature-face" cx="110" cy="50" r="9" />
    </>
  ),
}

export function FeatureVisual({ kind }: { kind: keyof typeof featureGeometry }) {
  return (
    <svg
      className={`feature-visual feature-${kind}`}
      viewBox="0 0 220 100"
      fill="none"
      aria-hidden="true"
    >
      <path className="feature-guide" d="M18 82H202M110 10V90" />
      {featureGeometry[kind]}
    </svg>
  )
}
