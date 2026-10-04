import { isAssemblyLibraryToolName } from "@vibeshape/automation-api/assembly-result-context"
import { isLocalBinaryExport } from "@vibeshape/automation-api/binary-exports"
import {
  automationDraftOperationRequestSchema,
  createAutomationDraftRequestSchema,
} from "@vibeshape/automation-api/drafts"
import { historyOperationSchema } from "@vibeshape/automation-api/history-tools"
import {
  isLocalDraftCommand,
  isLocalDraftInspection,
  isLocalInspection,
  isLocalMetadataRead,
  LOCAL_EXPORT_MAX_BYTES,
  type LocalMetadataReadOperation,
  type LocalOperation,
  localFailure,
} from "@vibeshape/automation-api/local-tools"
import type {
  CadInspectionDetailQuery,
  CadInspectionListQuery,
  ModelBodyMeasurementQuery,
  ModelBodyTopologyQuery,
  ModelEdgeQuery,
  ModelMeasurementQuery,
  QueryResult,
  SketchSolutionQuery,
  VariableListQuery,
} from "@vibeshape/automation-api/queries"
import { serializedQueryBytes } from "@vibeshape/automation-api/query-byte-budget"
import type { AutomationHost, AutomationHostResult } from "@vibeshape/automation-host/host"
import type { CommandActor } from "@vibeshape/domain"
import type { ActiveAutomationInfo } from "../document/document-controller"
import type { createBrowserAssemblyAutomationSession } from "./assembly-automation-session"
import type { createBinaryExportSession } from "./binary-export-session"
import type { createBrowserHistoryAutomationSession } from "./history-automation-session"
import { createLocalBasicFeatureCommand } from "./local-basic-feature-command"
import { createLocalCadCommand } from "./local-cad-command"
import { createLocalInspectionQuery } from "./local-inspection-query"
import { createLocalVariableCommand } from "./local-variable-command"
import type { createMetadataAutomationSession } from "./metadata-automation-session"

type LocalExportResult =
  | { ok: true; format: "step" | "stl" | "3mf"; file: Uint8Array; documentName: string }
  | { ok: false; diagnostic: { code: string; message: string; retryable: boolean } }

type LocalSessionPort = Readonly<{
  documentId: string
  revision: number
  host: AutomationHost
  metadata?: ReturnType<typeof createMetadataAutomationSession>
  readSketchSolution?: (query: SketchSolutionQuery) => Promise<QueryResult>
  history?: ReturnType<typeof createBrowserHistoryAutomationSession>
  assembly?: ReturnType<typeof createBrowserAssemblyAutomationSession>
  exports?: ReturnType<typeof createBinaryExportSession>
  readInfo: () => ActiveAutomationInfo | null
  readCad: (
    query:
      | CadInspectionListQuery
      | CadInspectionDetailQuery
      | VariableListQuery
      | ModelEdgeQuery
      | ModelMeasurementQuery
      | ModelBodyMeasurementQuery
      | ModelBodyTopologyQuery,
  ) => QueryResult
  exportRevisionBound: (
    format: "step" | "stl" | "3mf",
    revision: number,
  ) => Promise<LocalExportResult>
}>

export type LocalToolExecutor = Readonly<{
  execute: (operation: LocalOperation, signal?: AbortSignal) => Promise<unknown>
}>

function diagnostic(result: Extract<AutomationHostResult<unknown>, { ok: false }>) {
  return localFailure(
    result.diagnostic.code,
    result.diagnostic.message,
    result.diagnostic.retryable,
  )
}

function operationRequest(operation: LocalOperation, documentId: string) {
  if (operation.tool === "create_draft")
    return createAutomationDraftRequestSchema.parse({
      schemaVersion: 1,
      documentId,
      baseRevision: operation.arguments.baseRevision,
    })
  const draftId = "draftId" in operation.arguments ? operation.arguments.draftId : undefined
  return automationDraftOperationRequestSchema.parse({ schemaVersion: 1, draftId })
}

function encodeExport(
  session: LocalSessionPort,
  operation: Extract<LocalOperation, { tool: "export_model" }>,
) {
  return session
    .exportRevisionBound(operation.arguments.format, operation.arguments.revision)
    .then((exported) => {
      if (!exported.ok)
        return localFailure("export-failed", "The model could not be exported.", true)
      if (exported.file.byteLength > LOCAL_EXPORT_MAX_BYTES)
        return localFailure("export-too-large", "The exported model exceeds the size limit.")
      let binary = ""
      for (let index = 0; index < exported.file.length; index += 0x8000)
        binary += String.fromCharCode(...exported.file.subarray(index, index + 0x8000))
      const mimeType =
        exported.format === "step"
          ? "model/step"
          : exported.format === "stl"
            ? "model/stl"
            : "model/3mf"
      return {
        ok: true as const,
        value: {
          documentId: session.documentId,
          revision: operation.arguments.revision,
          format: exported.format,
          filename: `model.${exported.format}`,
          mimeType,
          base64: btoa(binary),
        },
      }
    })
}

async function dispatchDraftLifecycle(
  session: LocalSessionPort,
  actor: CommandActor,
  operation: Extract<
    LocalOperation,
    { tool: "create_draft" | "preview_draft" | "commit_draft" | "discard_draft" }
  >,
) {
  const request = operationRequest(operation, session.documentId)
  switch (operation.tool) {
    case "create_draft":
      return session.host.createDraft(actor, request)
    case "preview_draft":
      return session.host.previewDraft(actor, request)
    case "commit_draft":
      return session.host.commitDraft(actor, request)
    case "discard_draft":
      return session.host.discardDraft(actor, request)
  }
}

function readModelInfo(session: LocalSessionPort) {
  const info = session.readInfo()
  if (info && serializedQueryBytes(info) > 128 * 1024)
    return localFailure(
      "query-result-too-large",
      "Complete model diagnostics and measurements exceed the 128 KiB response budget.",
    )
  return info
    ? { ok: true as const, value: info }
    : localFailure("stale-revision", "The active document changed.", true)
}

function isVariableCommand(operation: LocalOperation): operation is Extract<
  LocalOperation,
  {
    tool:
      | "create_variable"
      | "set_variable_expression"
      | "rename_variable"
      | "remove_variable"
      | "replace_variable_table"
  }
> {
  return (
    operation.tool === "create_variable" ||
    operation.tool === "set_variable_expression" ||
    operation.tool === "rename_variable" ||
    operation.tool === "remove_variable" ||
    operation.tool === "replace_variable_table"
  )
}

function draftCommandRequest(
  operation: Extract<LocalOperation, { arguments: { commandId: string; draftId: string } }>,
  actor: CommandActor,
  documentId: string,
) {
  if (isVariableCommand(operation)) return createLocalVariableCommand(operation, actor, documentId)
  switch (operation.tool) {
    case "create_box":
    case "create_fillet":
    case "update_fillet":
    case "create_chamfer":
    case "update_chamfer":
      return createLocalBasicFeatureCommand(operation, actor, documentId)
    default:
      return createLocalCadCommand(operation, actor, documentId)
  }
}

async function dispatchDraftCommand(
  session: LocalSessionPort,
  actor: CommandActor,
  operation: Extract<LocalOperation, { arguments: { commandId: string; draftId: string } }>,
) {
  const request = draftCommandRequest(operation, actor, session.documentId)
  const result = await session.host.applyCommand(actor, request)
  return result.ok ? { ok: true as const, value: result.value } : diagnostic(result)
}

function hostResult(result: AutomationHostResult<unknown>) {
  return result.ok ? { ok: true as const, value: result.value } : diagnostic(result)
}

const metadataKinds = {
  model_parts: "parts",
  model_folders: "folders",
  model_history: "history",
} as const
function readMetadata(session: LocalSessionPort, operation: LocalMetadataReadOperation) {
  return session.metadata
    ? session.metadata.read(metadataKinds[operation.tool], operation.arguments)
    : localFailure("authored-metadata-unavailable", "The paired document has no authored metadata.")
}
function changeMetadata(
  session: LocalSessionPort,
  actor: CommandActor,
  operation: Extract<LocalOperation, { tool: "change_metadata" }>,
  signal?: AbortSignal,
) {
  return session.metadata
    ? session.metadata.change(actor, operation.arguments, signal)
    : localFailure("authored-metadata-unavailable", "The paired document has no authored metadata.")
}

async function dispatchBasicOperation(
  session: LocalSessionPort,
  actor: CommandActor,
  operation: LocalOperation,
) {
  switch (operation.tool) {
    case "model_info":
      return readModelInfo(session)
    case "export_model":
      return encodeExport(session, operation)
    case "create_draft":
    case "preview_draft":
    case "commit_draft":
    case "discard_draft": {
      const result = await dispatchDraftLifecycle(session, actor, operation)
      return hostResult(result)
    }
    default:
      return localFailure("invalid-operation", "The named automation operation is unavailable.")
  }
}

export function createLocalToolExecutor(
  session: LocalSessionPort,
  actor: CommandActor,
): LocalToolExecutor {
  function transfer(
    operation: Extract<
      LocalOperation,
      {
        tool:
          | "prepare_model_export"
          | "prepare_project_backup"
          | "read_export_chunk"
          | "discard_export"
      }
    >,
    signal?: AbortSignal,
  ) {
    return session.exports
      ? session.exports.execute(actor, operation, signal)
      : localFailure(
          "export-unavailable",
          "The paired session cannot prepare file transfers.",
          true,
        )
  }
  function dispatchSessionExtension(operation: LocalOperation, signal?: AbortSignal) {
    const history = historyOperationSchema.safeParse(operation)
    if (history.success)
      return session.history
        ? session.history.execute(actor, history.data, signal)
        : localFailure("history-unavailable", "The paired session cannot navigate saved changes.")
    if (isAssemblyLibraryToolName(operation.tool))
      return session.assembly
        ? session.assembly.execute(actor, operation, signal)
        : localFailure(
            "assembly-authority-unavailable",
            "The paired document has no assembly authority.",
          )
    return null
  }
  async function execute(operation: LocalOperation, signal?: AbortSignal) {
    const routed = dispatchSessionExtension(operation, signal)
    if (routed) return routed
    if (isLocalBinaryExport(operation)) return transfer(operation, signal)
    if (isLocalMetadataRead(operation)) return readMetadata(session, operation)
    if (operation.tool === "change_metadata")
      return changeMetadata(session, actor, operation, signal)
    if (isLocalDraftCommand(operation)) return dispatchDraftCommand(session, actor, operation)
    if (isLocalDraftInspection(operation)) {
      const result = await session.host.inspectDraft(actor, {
        schemaVersion: 1,
        draftId: operation.arguments.draftId,
        query: createLocalInspectionQuery(operation, session.documentId),
      })
      return hostResult(result)
    }
    if (isLocalInspection(operation)) return readCommittedInspection(session, operation)
    return dispatchBasicOperation(session, actor, operation)
  }
  return {
    execute: (operation, signal) =>
      signal?.aborted
        ? Promise.resolve(
            localFailure("request-cancelled", "The automation request was cancelled.", true),
          )
        : execute(operation, signal),
  }
}

export type { LocalOperation }

async function readCommittedInspection(
  session: LocalSessionPort,
  operation: import("@vibeshape/automation-api/local-tools").LocalInspectionOperation,
) {
  const query = createLocalInspectionQuery(operation, session.documentId)
  if (query.kind === "org.vibeshape.sketch.solution" && !session.readSketchSolution)
    return localFailure(
      "geometry-unavailable",
      "The paired session cannot inspect solved sketches.",
      true,
    )
  const result =
    query.kind === "org.vibeshape.sketch.solution"
      ? await session.readSketchSolution?.(query)
      : session.readCad(query)
  if (!result)
    return localFailure("geometry-unavailable", "Solved sketch inspection is unavailable.", true)
  return result.ok ? { ok: true, value: result.view } : diagnostic(result)
}
