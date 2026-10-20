import type { SurfaceTextureMap } from "@vibeshape/domain/surface-textures"
import { sampleSurfaceTexturePattern } from "@vibeshape/geometry-worker/surface-texture"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Star } from "@vibeshape/ui/components/icons"
import { Input } from "@vibeshape/ui/components/input"
import { cn } from "@vibeshape/ui/lib/cn"
import { useEffect, useRef, useState } from "react"
import { z } from "zod"

type Pattern = Extract<SurfaceTextureMap, { kind: "builtin" }>["pattern"]
const patterns: readonly Pattern[] = ["noise", "ridges", "dots", "knurling", "hexagons", "wood"]
const favoritesSchema = z.array(z.enum(patterns as [Pattern, ...Pattern[]])).max(6)
const favoritesKey = "vibeshape.surface-texture.favorites"

function readFavorites(): Pattern[] {
  try {
    const result = favoritesSchema.safeParse(JSON.parse(localStorage.getItem(favoritesKey) ?? "[]"))
    return result.success ? result.data : []
  } catch {
    return []
  }
}

export function TextureThumbnail({
  map,
  className,
}: {
  map: SurfaceTextureMap
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = ref.current?.getContext("2d")
    if (!context) return
    const pixels = context.createImageData(64, 64)
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const value =
          map.kind === "builtin"
            ? Math.round(sampleSurfaceTexturePattern(map.pattern, x / 64, y / 64) * 255)
            : (map.pixels[
                Math.min(map.height - 1, Math.floor((y / 64) * map.height)) * map.width +
                  Math.min(map.width - 1, Math.floor((x / 64) * map.width))
              ] ?? 0)
        const offset = (y * 64 + x) * 4
        pixels.data[offset] = value
        pixels.data[offset + 1] = value
        pixels.data[offset + 2] = value
        pixels.data[offset + 3] = 255
      }
    context.putImageData(pixels, 0, 0)
  }, [map])
  return (
    <span aria-hidden="true" className={cn("aspect-square w-full", className)}>
      <canvas
        width={64}
        height={64}
        ref={ref}
        className="aspect-square w-full rounded border bg-muted"
      />
    </span>
  )
}

export function TextureGallery({
  selected,
  onSelect,
  onDone,
}: {
  selected: SurfaceTextureMap
  onSelect: (map: SurfaceTextureMap) => void
  onDone: () => void
}) {
  const t = useTranslations("app.surfaceTexture")
  const [query, setQuery] = useState("")
  const [favorites, setFavorites] = useState(readFavorites)
  const [filter, setFilter] = useState<"all" | "favorites">("all")
  const shown = patterns.filter(
    (pattern) =>
      (filter !== "favorites" || favorites.includes(pattern)) &&
      t(`patterns.${pattern}`).toLowerCase().includes(query.toLowerCase()),
  )
  function toggleFavorite(pattern: Pattern) {
    const next = favorites.includes(pattern)
      ? favorites.filter((item) => item !== pattern)
      : [...favorites, pattern]
    setFavorites(next)
    try {
      localStorage.setItem(favoritesKey, JSON.stringify(next))
    } catch {
      /* Favorites do not block modeling when storage is unavailable. */
    }
  }
  return (
    <section aria-label={t("gallery")} className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t("gallery")}</h2>
        <Button type="button" size="sm" onClick={onDone}>
          {t("done")}
        </Button>
      </div>
      <Input
        aria-label={t("search")}
        placeholder={t("search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={filter === "all" ? "secondary" : "ghost"}
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          {t("all")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter === "favorites" ? "secondary" : "ghost"}
          aria-pressed={filter === "favorites"}
          onClick={() => setFilter("favorites")}
        >
          {t("favorites")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("galleryHint")}</p>
      <div className="grid grid-cols-2 gap-3">
        {shown.map((pattern) => (
          <div key={pattern} className="relative">
            <Button
              size="content"
              type="button"
              variant="ghost"
              className={cn(
                "w-full flex-col gap-2",
                selected.kind === "builtin" && selected.pattern === pattern && "ring-2 ring-ring",
              )}
              aria-pressed={selected.kind === "builtin" && selected.pattern === pattern}
              onClick={() => onSelect({ kind: "builtin", pattern })}
            >
              <TextureThumbnail map={{ kind: "builtin", pattern }} />
              <span className="text-xs">{t(`patterns.${pattern}`)}</span>
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              className="absolute right-2 top-2 aria-pressed:ring-2 aria-pressed:ring-ring"
              aria-label={t("favoritePattern", { pattern: t(`patterns.${pattern}`) })}
              aria-pressed={favorites.includes(pattern)}
              onClick={() => toggleFavorite(pattern)}
            >
              <Star aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      {shown.length === 0 && <p className="text-xs text-muted-foreground">{t("noTextures")}</p>}
    </section>
  )
}
