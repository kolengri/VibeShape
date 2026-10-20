import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"

export function printExportWorkerFailure(message = "Body Lid contains a degenerate triangle.") {
  return Object.assign(new Error("Worker rejected export."), {
    response: {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f21fe",
      documentId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
      revision: 1,
      generation: 1,
      type: "failure",
      diagnostic: { code: "export-failed", message, retryable: false },
    },
  })
}
