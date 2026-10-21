import { exportSavedProjectBackup } from "./project-backup-service"

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  void exportSavedProjectBackup(event.data).then(
    (result) => globalThis.postMessage(result, { transfer: result.ok ? [result.file.buffer] : [] }),
    () =>
      globalThis.postMessage({
        ok: false,
        diagnostic: { code: "backup-failed", message: "The native project backup failed." },
      }),
  )
})
