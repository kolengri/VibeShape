import {
  ASSISTANT_MAX_IMAGE_ATTACHMENT_BYTES,
  ASSISTANT_MAX_TEXT_ATTACHMENT_BYTES,
  type AssistantAttachment,
  type AssistantAttachmentCapabilities,
  assistantAttachmentsSupported,
} from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { FieldError } from "@vibeshape/ui/components/field"
import { FileText, X } from "@vibeshape/ui/components/icons"
import { AssistantIconAction } from "./assistant-icon-action"

type AttachmentIssue = "unsupported" | "too-large" | "invalid-text" | "read-failed"
export type AssistantAttachmentDraft = {
  id: string
  name: string
  size: number
  status: "pending" | "ready" | "error"
  attachment?: AssistantAttachment
  issue?: AttachmentIssue
  limit?: number
}

function imageMimeType(type: string) {
  switch (type) {
    case "image/png":
    case "image/jpeg":
    case "image/webp":
    case "image/gif":
      return type
    default:
      return null
  }
}

function readFile(file: File) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result)
      else reject(new Error("Unexpected file reader result"))
    }
    reader.onerror = () => reject(reader.error)
    reader.onabort = () => reject(new Error("File reading canceled"))
    reader.readAsArrayBuffer(file)
  })
}

type AttachmentFormat =
  | { type: "text"; mimeType: string; limit: number }
  | { type: "image"; mimeType: NonNullable<ReturnType<typeof imageMimeType>>; limit: number }

function supportedTextFile(file: File) {
  return (
    file.type.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript"].includes(file.type) ||
    /\.(txt|md|markdown|csv|tsv|json|xml|html|css|js|jsx|ts|tsx|py|rs|go|c|h|cpp|hpp|yaml|yml|toml|log|svg|step|stp|dxf)$/i.test(
      file.name,
    )
  )
}

function attachmentFormat(
  file: File,
  capabilities: AssistantAttachmentCapabilities,
): AttachmentFormat | null {
  const mimeType = imageMimeType(file.type)
  if (mimeType) {
    const constraints = capabilities.imageConstraints
    if (!capabilities.images || (constraints && !constraints.mimeTypes.includes(mimeType)))
      return null
    const limit = constraints
      ? Math.min(
          ASSISTANT_MAX_IMAGE_ATTACHMENT_BYTES,
          Math.floor(constraints.maxTotalBase64Bytes / 4) * 3,
        )
      : ASSISTANT_MAX_IMAGE_ATTACHMENT_BYTES
    return { type: "image", mimeType, limit }
  }
  if (!capabilities.text || !supportedTextFile(file)) return null
  return {
    type: "text",
    mimeType: file.type || "text/plain",
    limit: ASSISTANT_MAX_TEXT_ATTACHMENT_BYTES,
  }
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return text.includes("\0") ? null : text
  } catch {
    return null
  }
}

function decodeAttachment(
  file: File,
  id: string,
  format: AttachmentFormat,
  bytes: Uint8Array,
): AssistantAttachment | null {
  if (format.type === "image") {
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return { id, name: file.name, type: "image", mimeType: format.mimeType, data: btoa(binary) }
  }
  const text = decodeUtf8(bytes)
  if (text === null) return null
  return { id, name: file.name, type: "text", mimeType: format.mimeType, text }
}

export async function readAssistantAttachment(
  file: File,
  id: string,
  capabilities: AssistantAttachmentCapabilities,
): Promise<AssistantAttachmentDraft> {
  const draft = { id, name: file.name, size: file.size }
  const format = attachmentFormat(file, capabilities)
  if (!format) return { ...draft, status: "error", issue: "unsupported" }
  if (file.size > format.limit)
    return { ...draft, status: "error", issue: "too-large", limit: format.limit / 1024 ** 2 }
  try {
    const bytes = new Uint8Array(await readFile(file))
    const attachment = decodeAttachment(file, id, format, bytes)
    if (!attachment) return { ...draft, status: "error", issue: "invalid-text" }
    return { ...draft, status: "ready", attachment }
  } catch {
    return { ...draft, status: "error", issue: "read-failed" }
  }
}

export function readyAssistantAttachments(files: readonly AssistantAttachmentDraft[]) {
  return files.flatMap((file) =>
    file.status === "ready" && file.attachment ? [file.attachment] : [],
  )
}

export function AssistantImageAttachmentFeedback({
  capabilities,
  attachments,
}: {
  capabilities: AssistantAttachmentCapabilities | undefined
  attachments: readonly AssistantAttachmentDraft[]
}) {
  const t = useTranslations("app.assistant")
  const limits = capabilities?.imageConstraints
  if (!limits) return null
  const unsupported = !assistantAttachmentsSupported(
    readyAssistantAttachments(attachments),
    capabilities,
  )
  const message = t(unsupported ? "attachmentImageEnvelopeExceeded" : "attachmentImageLimits", {
    formats: limits.mimeTypes.map((type) => type.slice(6).toUpperCase()).join(", "),
    count: limits.maxCount,
    limit: (Math.floor(limits.maxTotalBase64Bytes / 4) * 3) / 1024,
  })
  return unsupported ? (
    <FieldError className="px-3 pt-2">{message}</FieldError>
  ) : (
    <p className="px-3 pt-2 text-xs text-muted-foreground">{message}</p>
  )
}

export function AssistantAttachments({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: readonly AssistantAttachmentDraft[]
  disabled: boolean
  onRemove: (id: string) => void
}) {
  const t = useTranslations("app.assistant")
  if (!attachments.length) return null
  return (
    <ul aria-label={t("attachments")} className="flex flex-wrap gap-1 px-3 pt-2">
      {attachments.map((file) => (
        <li key={file.id} className="max-w-full rounded-md border bg-background text-xs">
          <div
            className="flex min-w-0 items-center gap-1 pl-2"
            aria-busy={file.status === "pending"}
          >
            {file.attachment?.type === "image" ? (
              <img
                src={`data:${file.attachment.mimeType};base64,${file.attachment.data}`}
                alt=""
                width={32}
                height={32}
                className="size-8 shrink-0 rounded-sm object-contain"
              />
            ) : (
              <FileText aria-hidden="true" className="size-3 shrink-0" />
            )}
            <span className="min-w-0 truncate">{file.name}</span>
            {file.status === "pending" && (
              <span className="sr-only">{t("attachmentReading", { name: file.name })}</span>
            )}
            <AssistantIconAction
              label={t("removeAttachment", { name: file.name })}
              disabled={disabled}
              onAction={() => onRemove(file.id)}
            >
              <X aria-hidden="true" />
            </AssistantIconAction>
          </div>
          {file.status === "error" && (
            <Alert className="max-w-64">
              {file.issue === "too-large"
                ? t("attachmentTooLarge", { name: file.name, limit: file.limit ?? 0 })
                : file.issue === "unsupported"
                  ? t("attachmentUnsupported", { name: file.name })
                  : file.issue === "invalid-text"
                    ? t("attachmentInvalidText", { name: file.name })
                    : t("attachmentReadFailed", { name: file.name })}
            </Alert>
          )}
        </li>
      ))}
    </ul>
  )
}
