export function ApplicationWordmark({ saving }: { saving: boolean }) {
  return (
    <strong className="inline-flex items-center text-sm" data-saving={saving || undefined}>
      <span className="sr-only">VibeShape</span>
      <span aria-hidden="true" className="relative inline-grid w-[0.8em] place-items-center">
        <span className={saving ? "invisible" : undefined}>V</span>
        {saving && (
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            className="absolute size-[1.15em] text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 20h16M6 18V3h12v15M6 6h12" />
            <path d="M9 17h6M9 14h6M11 11h2" className="opacity-60" />
            <g className="application-wordmark-print-head">
              <path d="M10 4h4v4h-4zM12 8v2" />
            </g>
          </svg>
        )}
      </span>
      <span aria-hidden="true">ibeShape</span>
    </strong>
  )
}
