import { prepareF3dImport } from "@vibeshape/formats/f3d"

// One disposable worker owns all untrusted archive and binary-record processing.
globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  try {
    if (!(event.data instanceof Uint8Array)) throw new Error("Invalid F3D worker input.")
    globalThis.postMessage({ ok: true, value: prepareF3dImport(event.data) })
  } catch (error) {
    globalThis.postMessage({
      ok: false,
      message:
        error instanceof Error
          ? error.message.slice(0, 4096)
          : "The F3D archive could not be read.",
    })
  }
})
