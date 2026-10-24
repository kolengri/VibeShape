import { projectImportRequestSchema } from "./project-import-contract"
import { createProjectImportPreparation } from "./project-import-service"

const prepare = createProjectImportPreparation()
globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  void prepare(event.data)
    .then((result) => {
      const value = result.kind === "prepared" ? result.value : null
      const transfer =
        value && (value.version === 5 || value.version === 6 || value.version === 7)
          ? value.project.assetBlobs.map(({ bytes }) => bytes.buffer)
          : []
      globalThis.postMessage(result, { transfer })
    })
    .catch(() => {
      const request = projectImportRequestSchema.safeParse(event.data)
      globalThis.postMessage({
        schemaVersion: 0,
        jobId: request.success ? request.data.jobId : null,
        kind: "error",
        diagnostic: { code: "import-failed", message: "The native project import failed." },
      })
    })
})
