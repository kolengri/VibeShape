import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { CircleHelp, Copy } from "@vibeshape/ui/components/icons"
import { Input } from "@vibeshape/ui/components/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { useState } from "react"
import { useDialogOpen } from "../components/use-dialog-open"
import { getDesktopHost } from "../desktop/desktop-host"
import { DesktopMcpSettings } from "../desktop/desktop-mcp-settings"

const pages = ["mcp", "files", "reconnect"] as const
type Page = (typeof pages)[number]
const mcpHelpCopy = {
  local: {
    intro: "localIntro",
    steps: ["localClientStep", "localEditorStep", "applyStep"],
    prompt: "localPrompt",
    safety: "localSafety",
  },
  remote: {
    intro: "intro",
    steps: ["clientStep", "editorStep", "consentStep", "applyStep"],
    prompt: "prompt",
    safety: "safety",
  },
} as const

export function FaqDialog({
  endpoint,
  showTrigger = true,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
}: {
  endpoint?: string | undefined
  showTrigger?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const t = useTranslations("app.shell.faq")
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const [page, setPage] = useState<Page>("mcp")
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <Tooltip>
          <DialogTrigger asChild>
            <TooltipTrigger asChild>
              <Button type="button" size="icon" variant="outline" aria-label={t("trigger")}>
                <CircleHelp aria-hidden="true" />
              </Button>
            </TooltipTrigger>
          </DialogTrigger>
          <TooltipContent>{t("trigger")}</TooltipContent>
        </Tooltip>
      ) : null}
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        closeLabel={t("close")}
        className="max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid min-w-0 gap-5 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <nav aria-label={t("navigation")} className="flex flex-wrap gap-1 sm:flex-col">
              {pages.map((item) => (
                <Button
                  size="content"
                  key={item}
                  type="button"
                  variant={item === page ? "secondary" : "ghost"}
                  className="justify-start text-left"
                  aria-current={item === page ? "page" : undefined}
                  onClick={() => setPage(item)}
                >
                  {t(`${item}.title`)}
                </Button>
              ))}
            </nav>
            <article className="grid min-w-0 content-start gap-4 text-sm">
              <h2 className="font-semibold">{t(`${page}.title`)}</h2>
              {page === "mcp" ? (
                <McpHelp endpoint={endpoint} />
              ) : (
                <>
                  <p>{t(`${page}.body`)}</p>
                  <p className="text-muted-foreground">{t(`${page}.detail`)}</p>
                </>
              )}
            </article>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function McpHelp({ endpoint }: { endpoint?: string | undefined }) {
  if (getDesktopHost()) return <DesktopMcpSettings />
  return <ServerMcpHelp endpoint={endpoint} />
}

function ServerMcpHelp({ endpoint }: { endpoint?: string | undefined }) {
  const t = useTranslations("app.shell.faq")
  // Built stdio editors share this marker but do not serve HTTP MCP.
  const developmentEndpoint =
    import.meta.env.DEV &&
    document.querySelector('meta[name="vibeshape-local-automation"][content="1"]')
      ? new URL("/mcp", window.location.origin).href
      : undefined
  const currentEndpoint = developmentEndpoint ?? endpoint
  const copy = mcpHelpCopy[developmentEndpoint ? "local" : "remote"]
  return (
    <>
      <p>{t(`mcp.${copy.intro}`)}</p>
      {currentEndpoint ? (
        <>
          <CopyText label={t("mcp.urlLabel")} value={currentEndpoint} />
          <CopyText
            label={t("mcp.promptLabel")}
            value={t(`mcp.${copy.prompt}`, { endpoint: currentEndpoint })}
            multiline
          />
          <ol className="list-decimal space-y-2 pl-5">
            {copy.steps.map((step) => (
              <li key={step}>{t(`mcp.${step}`)}</li>
            ))}
          </ol>
        </>
      ) : (
        <p role="status" className="text-muted-foreground">
          {t("mcp.unconfigured")}
        </p>
      )}
      <p className="text-muted-foreground">{t(`mcp.${copy.safety}`)}</p>
    </>
  )
}

function CopyText({
  label,
  value,
  multiline = false,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  const t = useTranslations("app.shell.faq")
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={t("copy", { label })}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(value)
                  setStatus("copied")
                } catch {
                  setStatus("failed")
                }
              }}
            >
              <Copy aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("copy", { label })}</TooltipContent>
        </Tooltip>
      </div>
      {multiline ? (
        <textarea
          aria-label={label}
          readOnly
          value={value}
          rows={9}
          className="min-w-0 w-full resize-y rounded-md border bg-muted p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <Input aria-label={label} readOnly value={value} className="font-mono text-xs" />
      )}
      {status !== "idle" ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t(status)}
        </p>
      ) : null}
    </div>
  )
}
