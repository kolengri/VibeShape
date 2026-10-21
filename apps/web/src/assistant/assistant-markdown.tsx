import { useTranslations } from "@vibeshape/i18n"
import { cn } from "@vibeshape/ui/lib/cn"
import { useId, useMemo } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

const components: Components = {
  // Model-authored image URLs must not trigger background network requests.
  img: ({ alt }) => <span>{alt}</span>,
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
}

export function AssistantMarkdown({ text }: { text: string }) {
  const t = useTranslations("app.assistant")
  const prefix = `assistant-${useId()}-`
  const scopedComponents = useMemo<Components>(
    () => ({
      ...components,
      a: ({ node: _node, href, ...props }) =>
        href ? (
          <a
            {...props}
            href={href}
            aria-describedby={
              props["aria-describedby"] === "footnote-label"
                ? `${prefix}footnote-label`
                : props["aria-describedby"]
            }
            target={href.startsWith("#") ? undefined : "_blank"}
            rel={href.startsWith("#") ? undefined : "noopener noreferrer"}
          />
        ) : (
          <span>{props.children}</span>
        ),
      h2: ({ node: _node, id, ...props }) => (
        <h2 {...props} id={id === "footnote-label" ? `${prefix}${id}` : id} />
      ),
    }),
    [prefix],
  )
  return (
    <div
      className={cn(
        "min-w-0 space-y-2 break-words text-sm",
        "[&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_strong]:font-semibold",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
        "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_a]:rounded-sm [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-ring",
        "[&_code]:font-mono [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1",
        "[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs",
        "[&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1",
        "[&_hr]:border-border",
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{
          clobberPrefix: prefix,
          footnoteLabel: t("footnoteLabel"),
          footnoteBackLabel: (referenceIndex, occurrence) =>
            t("footnoteBackLabel", { reference: referenceIndex + 1, occurrence }),
        }}
        components={scopedComponents}
        skipHtml
      >
        {text}
      </Markdown>
    </div>
  )
}
