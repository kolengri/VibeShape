const CACHE_NAME = "vibeshape-persistence-spike-v0"
const SHELL_PATH = "/spikes/persistence.html"
let simulateNetworkOutage = false

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(SHELL_PATH)))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("message", (event) => {
  if (event.data?.type !== "vibeshape.persistence.network") return
  simulateNetworkOutage = event.data.offline === true
  event.ports[0]?.postMessage({ offline: simulateNetworkOutage })
})

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url)
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return

  event.respondWith(
    (simulateNetworkOutage
      ? Promise.reject(new TypeError("The persistence spike network is unavailable."))
      : fetch(event.request)
    )
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true })
        if (cached) return cached
        if (event.request.mode === "navigate") {
          const shell = await caches.match(SHELL_PATH)
          if (shell) return shell
        }
        return Response.error()
      }),
  )
})
