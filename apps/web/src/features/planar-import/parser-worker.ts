import { inspectPlanarRequest } from "./parser-service"

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  void inspectPlanarRequest(event.data).then(
    (result) => globalThis.postMessage(result),
    () =>
      globalThis.postMessage({
        schemaVersion: 0,
        ok: false,
        diagnostic: {
          code: "invalid-format",
          message: "The source could not be inspected within the supported geometry contract.",
        },
      }),
  )
})
