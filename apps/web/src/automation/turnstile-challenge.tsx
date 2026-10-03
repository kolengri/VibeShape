import { useEffect, useRef } from "react"

type Turnstile = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      action: string
      size: "flexible"
      callback: (token: string) => void
      "error-callback": () => void
      "expired-callback": () => void
    },
  ): string
  remove(id: string): void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}
let loading: Promise<Turnstile> | null = null
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    script.async = true
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Challenge did not load."))
    script.onerror = () => {
      script.remove()
      loading = null
      reject(new Error("Challenge did not load."))
    }
    document.head.append(script)
  })
  return loading
}

export function TurnstileChallenge({
  siteKey,
  onToken,
}: {
  siteKey: string
  onToken: (token: string | null) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    let widget: string | null = null
    let api: Turnstile | null = null
    void loadTurnstile()
      .then((turnstile) => {
        if (!alive || !container.current) return
        api = turnstile
        widget = turnstile.render(container.current, {
          sitekey: siteKey,
          action: "vibeshape-pair",
          size: "flexible",
          callback: (token) => {
            if (alive) onToken(token)
          },
          "error-callback": () => {
            if (alive) onToken(null)
          },
          "expired-callback": () => {
            if (alive) onToken(null)
          },
        })
      })
      .catch(() => {
        if (alive) onToken(null)
      })
    return () => {
      alive = false
      if (api && widget) api.remove(widget)
    }
  }, [siteKey, onToken])
  return <div ref={container} />
}
