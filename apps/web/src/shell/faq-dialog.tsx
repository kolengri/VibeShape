import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@vibeshape/ui/components/dialog"
import { Input } from "@vibeshape/ui/components/input"
import { useState } from "react"

const pages = ["mcp", "files", "reconnect"] as const
type Page = (typeof pages)[number]

export function FaqDialog({ endpoint }: { endpoint?: string | undefined }) {
  const t = useTranslations("app.shell.faq")
  const [page, setPage] = useState<Page>("mcp")
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="xs" variant="outline">
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-5 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <nav aria-label={t("navigation")} className="flex flex-wrap gap-1 sm:flex-col">
            {pages.map((item) => (
              <Button
                key={item}
                type="button"
                variant={item === page ? "secondary" : "ghost"}
                className="h-auto justify-start whitespace-normal text-left"
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
      </DialogContent>
    </Dialog>
  )
}

function McpHelp({ endpoint }: { endpoint?: string | undefined }) {
  const t = useTranslations("app.shell.faq")
  return (
    <>
      <p>{t("mcp.intro")}</p>
      {endpoint ? (
        <>
          <CopyText label={t("mcp.urlLabel")} value={endpoint} />
          <ol className="list-decimal space-y-2 pl-5">
            <li>{t("mcp.clientStep")}</li>
            <li>{t("mcp.editorStep")}</li>
            <li>{t("mcp.consentStep")}</li>
            <li>{t("mcp.applyStep")}</li>
          </ol>
          <CopyText label={t("mcp.promptLabel")} value={t("mcp.prompt", { endpoint })} multiline />
        </>
      ) : (
        <p role="status" className="text-muted-foreground">
          {t("mcp.unconfigured")}
        </p>
      )}
      <p className="text-muted-foreground">{t("mcp.safety")}</p>
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
      <span className="font-medium">{label}</span>
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
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setStatus("copied")
          } catch {
            setStatus("failed")
          }
        }}
      >
        {t("copy", { label })}
      </Button>
      {status !== "idle" ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t(status)}
        </p>
      ) : null}
    </div>
  )
}
