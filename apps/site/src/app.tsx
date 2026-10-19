import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Cable,
  Code,
  Download,
  HardDrive,
  LockKeyhole,
  Menu,
  Monitor,
  Ruler,
  X,
} from "lucide-react"
import { type MouseEvent, type ReactNode, useEffect, useState, useSyncExternalStore } from "react"
import { HeroVisual } from "./hero-visual"
import { articles, editorUrl, referenceUrl, releasesUrl, repository } from "./links"
import { AnimatedScene, ConstructionPlanes, FeatureVisual, PrintVisual } from "./spatial-visuals"

const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`
const subscribeToHash = (notify: () => void) => {
  window.addEventListener("hashchange", notify)
  return () => window.removeEventListener("hashchange", notify)
}
const getHash = () => window.location.hash

function focusSection(hash: string) {
  const section = document.getElementById(hash.slice(1))
  if (!section) return
  section.scrollIntoView()
  section.querySelector<HTMLHeadingElement>("h2")?.focus({ preventScroll: true })
}

function ActionLink({
  href,
  children,
  secondary = false,
}: {
  href: string
  children: ReactNode
  secondary?: boolean
}) {
  return (
    <Button
      asChild
      variant={secondary ? "outline" : "default"}
      className="h-auto min-h-12 rounded-lg px-5 py-3 text-sm"
    >
      <a href={href}>{children}</a>
    </Button>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-5 font-mono text-[11px] font-medium tracking-[0.15em] text-primary">
      {children}
    </p>
  )
}

function Header() {
  const t = useTranslations()
  const [menuOpen, setMenuOpen] = useState(false)
  const links = [
    { href: "#features", label: t("nav.features") },
    { href: "#workflow", label: t("nav.workflow") },
    { href: "#documentation", label: t("nav.docs") },
    { href: "#downloads", label: t("nav.downloads") },
  ]
  const closeNavigation = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    const modified = [event.metaKey, event.ctrlKey, event.shiftKey, event.altKey].includes(true)
    if (event.button !== 0 || modified) return
    setMenuOpen(false)
    if (window.location.hash !== href) return
    event.preventDefault()
    requestAnimationFrame(() => {
      if (window.location.hash === href) focusSection(href)
    })
  }
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-xl">
      <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-5 px-6 lg:px-12">
        <a
          href="#overview"
          aria-label="VibeShape"
          className="flex shrink-0 items-center gap-2.5 text-xl font-semibold tracking-tight"
        >
          <img src={assetUrl("brand/logo-mark.png")} alt="" width="32" height="32" />
          VibeShape
        </a>
        <nav aria-label={t("nav.label")} className="hidden items-center gap-7 text-sm md:flex">
          {links.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              onClick={(event) => closeNavigation(event, href)}
              className="py-3 text-muted-foreground transition-colors hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a
            href={repository}
            aria-label={t("nav.github")}
            className="hidden size-11 items-center justify-center rounded-lg hover:bg-muted lg:flex"
          >
            <Code size={19} />
          </a>
          <Button asChild className="hidden h-10 rounded-lg px-4 sm:inline-flex">
            <a href={editorUrl}>
              {t("nav.open")}
              <ArrowUpRight />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t("nav.menu")}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {menuOpen && (
        <nav
          id="mobile-navigation"
          aria-label={t("nav.label")}
          className="flex flex-col border-t border-border px-6 pb-4 md:hidden"
        >
          {links.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              onClick={(event) => closeNavigation(event, href)}
              className="rounded-lg py-3 text-sm hover:text-primary"
            >
              {label}
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}

function Hero() {
  const t = useTranslations("hero")
  return (
    <section
      id="overview"
      className="hero-scroll-section relative scroll-mt-20 border-b border-border"
    >
      <div className="hero-scroll-frame">
        <ConstructionPlanes />
        <div className="hero-scroll-content mx-auto grid w-full max-w-7xl items-center gap-4 px-6 pb-12 pt-16 md:grid-cols-2 md:pb-20 md:pt-24 lg:px-12">
          <div className="relative z-10">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1
              id="main-heading"
              tabIndex={-1}
              className="max-w-xl text-5xl font-medium leading-[1.06] tracking-[-0.055em] outline-none sm:text-6xl lg:text-7xl xl:text-8xl"
            >
              {t.rich("title", {
                accent: (chunks) => <span className="block text-primary">{chunks}</span>,
              })}
            </h1>
            <p className="mt-7 max-w-md text-lg leading-relaxed text-muted-foreground">
              {t("description")}
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ActionLink href={editorUrl}>
                {t("primary")}
                <ArrowUpRight size={16} />
              </ActionLink>
              <ActionLink href="#docs/getting-started" secondary>
                {t("secondary")}
                <ArrowRight size={16} />
              </ActionLink>
            </div>
            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">{t("note")}</p>
          </div>
          <div className="relative min-w-0">
            <HeroVisual
              source={assetUrl("media/hero-scroll.mp4")}
              poster={assetUrl("media/hero-scroll.jpg")}
              description={t("illustration")}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function UseCases() {
  const t = useTranslations("intro")
  return (
    <section className="relative mx-auto max-w-7xl px-6 py-20 lg:px-12 lg:py-28">
      <div className="grid gap-8 md:grid-cols-2 md:gap-16">
        <div>
          <Eyebrow>{t("label")}</Eyebrow>
          <h2 className="whitespace-pre-line text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
        </div>
        <p className="max-w-lg self-end text-base leading-relaxed text-muted-foreground">
          {t("description")}
        </p>
      </div>
      <div className="mt-12 grid items-center gap-8 border-t border-border pt-8 md:grid-cols-2 md:gap-16">
        <div className="grid gap-7">
          {(["bracket", "enclosure", "replacement"] as const).map((key) => (
            <div key={key} className="border-l border-primary/30 pl-5">
              <h3 className="mb-2 text-lg font-medium tracking-tight">{t(key)}</h3>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                {t(`${key}Body`)}
              </p>
            </div>
          ))}
        </div>
        <PrintVisual />
      </div>
    </section>
  )
}

function Features() {
  const t = useTranslations("features")
  const features = ["sketch", "solid", "assembly", "print", "privacy", "agent"] as const
  return (
    <section id="features" className="scroll-mt-24 border-y border-border bg-panel/60">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-12 lg:py-28">
        <Eyebrow>{t("label")}</Eyebrow>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2
            tabIndex={-1}
            className="whitespace-pre-line text-4xl font-medium leading-tight tracking-tight sm:text-5xl"
          >
            {t("title")}
          </h2>
          <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map((id) => (
            <AnimatedScene key={id} className="feature-scene bg-background p-7 lg:p-8">
              <FeatureVisual kind={id} />
              <h3 className="mb-3 text-lg font-medium tracking-tight">{t(id)}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{t(`${id}Body`)}</p>
            </AnimatedScene>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-between gap-3 text-xs leading-relaxed text-muted-foreground">
          <p className="max-w-2xl">{t("scope")}</p>
          <a
            href={referenceUrl("docs/product/feature-matrix.md")}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {t("matrix")}
            <ArrowUpRight size={13} />
          </a>
        </div>
      </div>
    </section>
  )
}

function Workflow() {
  const t = useTranslations("workflow")
  const [stage, setStage] = useState<"sketch" | "shape" | "export">("shape")
  return (
    <section id="workflow" className="workflow-section relative isolate scroll-mt-24">
      <ConstructionPlanes />
      <div className="relative mx-auto max-w-7xl px-6 py-20 lg:px-12 lg:py-28">
        <Eyebrow>{t("label")}</Eyebrow>
        <h2 tabIndex={-1} className="text-3xl font-medium tracking-tight sm:text-4xl">
          {t("title")}
        </h2>
        <p className="mt-4 text-muted-foreground">{t("description")}</p>
        <AnimatedScene className="workflow-scene mt-10 grid overflow-hidden rounded-xl border border-border bg-background md:grid-cols-2">
          <div className="p-6 sm:p-9">
            <fieldset aria-label={t("diagram")} className="flex flex-wrap gap-2">
              {(["sketch", "shape", "export"] as const).map((key) => (
                <Button
                  key={key}
                  variant={stage === key ? "default" : "ghost"}
                  onClick={() => setStage(key)}
                  aria-pressed={stage === key}
                  className="h-11 rounded-lg px-3"
                >
                  {t(key)}
                </Button>
              ))}
            </fieldset>
            <div aria-live="polite" className="mt-10 min-h-52">
              <p className="font-mono text-[11px] uppercase tracking-wider text-primary">
                {t(`${stage}Detail`)}
              </p>
              <h3 className="mb-4 mt-4 text-2xl font-medium tracking-tight">
                {t(`${stage}Title`)}
              </h3>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                {t(`${stage}Body`)}
              </p>
            </div>
            <a
              href="#docs/getting-started"
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              {t("guide")}
              <ArrowRight size={15} />
            </a>
          </div>
          <div
            key={stage}
            data-stage={stage}
            className="workflow-visual blueprint-grid flex min-h-80 flex-col items-center justify-center gap-7 border-t border-border p-8 md:border-l md:border-t-0"
            aria-hidden="true"
          >
            {stage === "sketch" ? (
              <>
                <div className="relative flex h-32 w-48 items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
                  <div className="size-12 rounded-full border-2 border-primary" />
                  <span className="absolute -top-6 font-mono text-xs text-primary">80 mm</span>
                  <span className="absolute -bottom-6 font-mono text-xs text-primary">Ø 20 mm</span>
                </div>
                <p className="mt-6 font-mono text-[11px] text-muted-foreground">
                  {t("dimensions")}
                </p>
              </>
            ) : stage === "shape" ? (
              <>
                <Box size={112} strokeWidth={0.65} className="text-primary" />
                <p className="font-mono text-[11px] text-muted-foreground">{t("history")}</p>
              </>
            ) : (
              <div className="w-full max-w-xs space-y-3">
                {[
                  [".vshape", "native"],
                  ["STEP", "exact"],
                  ["3MF / STL", "mesh"],
                ].map(([format, label]) => (
                  <div
                    key={format}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-4 text-xs"
                  >
                    <span className="font-mono text-primary">{format}</span>
                    <span className="text-muted-foreground">
                      {t(label as "native" | "exact" | "mesh")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </AnimatedScene>
      </div>
    </section>
  )
}

function AgentSection() {
  const t = useTranslations("ai")
  return (
    <section className="border-y border-border bg-panel/60">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 md:grid-cols-2 lg:gap-20 lg:px-12 lg:py-24">
        <div>
          <Eyebrow>{t("label")}</Eyebrow>
          <h2 className="whitespace-pre-line text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{t("description")}</p>
          <ul className="my-6 space-y-3 text-sm">
            {(["one", "two", "three"] as const).map((key) => (
              <li key={key} className="flex items-start gap-3">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {t(key)}
              </li>
            ))}
          </ul>
          <a
            href="#docs/mcp"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            {t("action")}
            <ArrowRight size={15} />
          </a>
        </div>
        <AnimatedScene className="agent-scene self-center overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-6 py-4 text-xs text-muted-foreground">
            <Cable size={15} />
            {t("terminalLabel")}
          </div>
          <div className="p-6 sm:p-8">
            <p className="border-l-2 border-primary pl-4 text-lg font-medium leading-relaxed tracking-tight">
              “{t("prompt")}”
            </p>
            <ol className="my-7 space-y-5">
              {(["inspect", "draft", "review", "export"] as const).map((key) => (
                <li key={key} className="flex gap-4 text-xs leading-relaxed">
                  <ArrowRight size={14} className="shrink-0 text-primary" aria-hidden="true" />
                  {t(key)}
                </li>
              ))}
            </ol>
            <p className="border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
              {t("note")}
            </p>
          </div>
        </AnimatedScene>
      </div>
    </section>
  )
}

const articleIcons = {
  start: BookOpen,
  install: Monitor,
  model: Ruler,
  agent: Cable,
  export: Download,
  privacy: LockKeyhole,
}

function Documentation() {
  const t = useTranslations()
  return (
    <section
      id="documentation"
      className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20 lg:px-12 lg:py-28"
    >
      <Eyebrow>{t("docs.label")}</Eyebrow>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <h2
          tabIndex={-1}
          className="whitespace-pre-line text-3xl font-medium leading-tight tracking-tight sm:text-4xl"
        >
          {t("docs.title")}
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t("docs.description")}
        </p>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map(({ id, icon }) => {
          const Icon = articleIcons[icon]
          return (
            <a
              key={id}
              href={`#docs/${id}`}
              className="group flex flex-col rounded-xl border border-border p-6 transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <div className="mb-8 flex items-center justify-between">
                <Icon size={23} strokeWidth={1.5} className="text-primary" />
                <ArrowUpRight
                  size={17}
                  className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                />
              </div>
              <p className="font-mono text-[10px] tracking-widest text-muted-foreground">
                {t(`articles.${id}.category`)}
              </p>
              <h3 className="mb-2 mt-2 text-lg font-medium tracking-tight">
                {t(`articles.${id}.title`)}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(`articles.${id}.summary`)}
              </p>
            </a>
          )
        })}
      </div>
      <a
        href={referenceUrl("docs/README.md")}
        className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        {t("docs.all")}
        <ArrowUpRight size={15} />
      </a>
    </section>
  )
}

function Downloads() {
  const t = useTranslations("downloads")
  return (
    <section id="downloads" className="scroll-mt-24 border-y border-border bg-panel/60">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-12 lg:py-28">
        <Eyebrow>{t("label")}</Eyebrow>
        <h2
          tabIndex={-1}
          className="whitespace-pre-line text-4xl font-medium leading-tight tracking-tight sm:text-5xl"
        >
          {t("title")}
        </h2>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
          {t("description")}
        </p>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col rounded-xl border border-primary/40 bg-background p-7">
            <div className="mb-8 flex min-h-6 items-center justify-between">
              <Monitor size={24} strokeWidth={1.5} className="text-primary" />
              <span className="font-mono text-[9px] tracking-widest text-primary">
                {t("recommended")}
              </span>
            </div>
            <h3 className="text-xl font-medium tracking-tight">{t("browser")}</h3>
            <p className="mb-7 mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
              {t("browserBody")}
            </p>
            <ActionLink href={editorUrl}>
              {t("browserAction")}
              <ArrowUpRight size={16} />
            </ActionLink>
          </div>
          <div className="flex flex-col rounded-xl border border-border bg-background p-7">
            <HardDrive size={24} strokeWidth={1.5} className="mb-8 text-primary" />
            <h3 className="text-xl font-medium tracking-tight">{t("local")}</h3>
            <p className="mb-7 mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
              {t("localBody")}
            </p>
            <ActionLink href="#docs/local-installation" secondary>
              {t("localAction")}
              <ArrowRight size={16} />
            </ActionLink>
            <a
              href={referenceUrl("docs/desktop-macos.md")}
              className="mt-4 text-sm text-primary hover:underline"
            >
              {t("desktop")}
            </a>
          </div>
          <div className="flex flex-col rounded-xl border border-border bg-background p-7">
            <Download size={24} strokeWidth={1.5} className="mb-8 text-muted-foreground" />
            <h3 className="text-xl font-medium tracking-tight">{t("installers")}</h3>
            <p className="mt-2 text-xs font-medium text-primary">{t("installerStatus")}</p>
            <p className="mb-7 mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
              {t("installerBody")}
            </p>
            <ActionLink href={releasesUrl} secondary>
              {t("releases")}
              <ArrowUpRight size={16} />
            </ActionLink>
          </div>
        </div>
        <div className="mt-12 flex items-start gap-4 border-t border-border pt-7">
          <LockKeyhole size={19} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-medium">{t("privacy")}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {t("privacyBody")}
            </p>
            <a
              href="#docs/privacy"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t("security")}
              <ArrowRight size={13} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function Faq() {
  const t = useTranslations("faq")
  return (
    <section className="mx-auto grid max-w-7xl gap-8 px-6 py-20 md:grid-cols-3 lg:px-12 lg:py-24">
      <h2 className="text-3xl font-medium tracking-tight">{t("title")}</h2>
      <div className="md:col-span-2">
        {(["price", "offline", "ai", "files"] as const).map((key) => (
          <details key={key} className="group border-b border-border py-5 first:border-t">
            <summary className="cursor-pointer text-sm font-medium">{t(`${key}Q`)}</summary>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t(`${key}A`)}
            </p>
          </details>
        ))}
      </div>
    </section>
  )
}

function Article({ article }: { article: (typeof articles)[number] }) {
  const t = useTranslations()
  const { id, reference } = article
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 md:grid-cols-4 lg:gap-16 lg:px-12 lg:py-16">
      <aside>
        <a
          href="#documentation"
          className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
        >
          <ArrowLeft size={14} />
          {t("docs.back")}
        </a>
        <nav aria-label={t("docs.navigation")} className="flex flex-wrap gap-1 md:flex-col">
          {articles.map((item) => (
            <a
              key={item.id}
              href={`#docs/${item.id}`}
              aria-current={item.id === id ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-3 text-sm transition-colors hover:bg-muted",
                item.id === id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground",
              )}
            >
              {t(`articles.${item.id}.title`)}
            </a>
          ))}
        </nav>
      </aside>
      <article className="min-w-0 md:col-span-3">
        <Eyebrow>{t(`articles.${id}.category`)}</Eyebrow>
        <h1
          id={`docs/${id}`}
          tabIndex={-1}
          className="scroll-mt-24 text-4xl font-medium leading-tight tracking-tight outline-none sm:text-5xl"
        >
          {t(`articles.${id}.title`)}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {t(`articles.${id}.intro`)}
        </p>
        <div className="my-10 max-w-2xl space-y-9">
          {(["one", "two", "three"] as const).map((key) => (
            <section key={key}>
              <h2 className="mb-3 text-xl font-medium tracking-tight">
                {t(`articles.${id}.${key}Title`)}
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                {t(`articles.${id}.${key}`)}
              </p>
              {id === "local-installation" && key === "one" && (
                <pre className="mt-5 overflow-x-auto rounded-xl border border-border bg-panel p-5 text-xs leading-loose">
                  <code>{`git clone ${repository}.git\ncd VibeShape\nbun install\nbun run dev`}</code>
                </pre>
              )}
            </section>
          ))}
        </div>
        <ActionLink href={referenceUrl(reference)} secondary>
          {t("docs.canonical")}
          <ArrowUpRight size={16} />
        </ActionLink>
        <p className="mt-6 max-w-2xl border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
          {t("docs.sourceNote")}
        </p>
        <a
          href="#documentation"
          className="mt-8 inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          {t("docs.next")}
          <ArrowRight size={15} />
        </a>
      </article>
    </div>
  )
}

function Footer() {
  const t = useTranslations("footer")
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-8 px-6 py-10 lg:px-12">
        <div>
          <a
            href="#overview"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <img src={assetUrl("brand/logo-mark.png")} alt="" width="25" height="25" />
            VibeShape
          </a>
          <p className="mt-3 text-xs text-muted-foreground">{t("line")}</p>
          <p className="mt-2 text-[10px] text-muted-foreground">{t("license")}</p>
        </div>
        <div className="flex flex-col items-start gap-4 text-xs text-muted-foreground sm:items-end">
          <div className="flex flex-wrap gap-6">
            <a href={repository} className="hover:text-primary">
              {t("source")}
            </a>
            <a href="#docs/privacy" className="hover:text-primary">
              {t("privacy")}
            </a>
            <a href={referenceUrl("docs/roadmap.md")} className="hover:text-primary">
              {t("roadmap")}
            </a>
          </div>
          <p>{t("made")}</p>
        </div>
      </div>
    </footer>
  )
}

export function App() {
  const t = useTranslations()
  const hash = useSyncExternalStore(subscribeToHash, getHash)
  const article = articles.find(({ id }) => hash === `#docs/${id}`)
  useEffect(() => {
    document.title = article
      ? t("metadata.articleTitle", { title: t(`articles.${article.id}.title`) })
      : t("metadata.landingTitle")
  }, [article, t])
  useEffect(() => {
    if (article || hash === "#overview") {
      window.scrollTo(0, 0)
      document.querySelector<HTMLHeadingElement>("main h1")?.focus({ preventScroll: true })
    } else if (hash) {
      focusSection(hash)
    }
  }, [article, hash])
  return (
    <>
      <Button
        onClick={() => document.getElementById("main")?.focus()}
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-primary px-5 py-3 text-primary-foreground focus:translate-y-0"
      >
        {t("nav.skip")}
      </Button>
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        {article ? (
          <Article article={article} />
        ) : (
          <>
            <Hero />
            <UseCases />
            <Features />
            <Workflow />
            <AgentSection />
            <Documentation />
            <Downloads />
            <Faq />
          </>
        )}
      </main>
      <Footer />
    </>
  )
}
