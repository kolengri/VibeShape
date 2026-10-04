import type { SurfaceTextureReviewInput } from "@vibeshape/automation-host/surface-texture-proposal-contract"
import type { SurfaceTextureLayer } from "@vibeshape/domain/surface-textures"
import { useFormatter, useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"
import { AutomationReviewFrame } from "./automation-review-frame"

function TextureRecipeDetails({ layer }: { layer: SurfaceTextureLayer }) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const texture = useTranslations("app.surfaceTexture")
  const format = useFormatter()
  const number = (value: number) => format.number(value, { maximumFractionDigits: 6 })
  const values = [
    [
      texture("texture"),
      layer.map.kind === "builtin"
        ? texture(`patterns.${layer.map.pattern}`)
        : t("textureMapDimensions", { width: layer.map.width, height: layer.map.height }),
    ],
    [
      texture("surfaces"),
      layer.target.kind === "body"
        ? texture("entireBody")
        : texture("selectedFaces", { count: layer.target.refs.length }),
    ],
    [texture("body"), layer.target.outputRole],
    [texture("height"), number(layer.heightMm)],
    [texture("direction"), texture(layer.direction)],
    [texture("mapping"), texture(`projections.${layer.mapping.kind}`)],
    [texture("axis"), layer.mapping.axis.toUpperCase()],
    [texture("width"), number(layer.sizeUMm)],
    [texture("length"), number(layer.sizeVMm)],
    [texture("rotation"), number(layer.rotationDeg)],
    [texture("offsetU"), number(layer.offsetUMm)],
    [texture("offsetV"), number(layer.offsetVMm)],
    [texture("boundaryFade"), number(layer.boundaryFadeMm)],
    [texture("overlap"), texture(layer.blend)],
    [texture("invert"), t("textureBoolean", { value: layer.invert ? "yes" : "no" })],
    [texture("layers"), t("textureEnabled", { value: layer.enabled ? "yes" : "no" })],
    [
      t("textureMask"),
      t("textureMaskSummary", { base: layer.mask.base, count: layer.mask.strokes.length }),
    ],
  ]
  return (
    <dl className="mt-2 grid gap-1">
      {values.map(([label, value]) => (
        <div key={label} className="flex flex-wrap justify-between gap-2">
          <dt>{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SurfaceTextureReviewPanel({
  input,
  client,
  diagnostic,
  actions,
  previewStatus,
}: {
  input: SurfaceTextureReviewInput
  client: string
  diagnostic: ReactNode
  actions: ReactNode
  previewStatus: "idle" | "loading" | "ready" | "error"
}) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const texture = useTranslations("app.surfaceTexture")
  return (
    <AutomationReviewFrame
      client={client}
      documentName={input.documentName}
      baseRevision={input.draft.baseRevision}
      description={t("surfaceTextureReviewDescription")}
      diagnostic={diagnostic}
      actions={actions}
    >
      <section className="mt-4 border-t pt-3">
        <h3 className="text-xs font-medium">
          {t(
            input.operation === "create"
              ? "createSurfaceTexture"
              : input.operation === "update"
                ? "updateSurfaceTexture"
                : "removeSurfaceTexture",
          )}
        </h3>
        <p className="mt-2 break-words text-xs">{t("target", { target: input.featureName })}</p>
        <p className="mt-1 break-all text-xs">{t("textureLayerId", { id: input.layerId })}</p>
        <ul className="mt-3 grid gap-2 text-xs">
          {input.command.payload.layers.map((layer) => (
            <li key={layer.id} className="rounded border p-2">
              <div className="break-all font-mono">{layer.id}</div>
              <TextureRecipeDetails layer={layer} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs" role="status">
          {input.command.payload.layers.some((layer) => layer.enabled)
            ? texture(`preview.${previewStatus}`)
            : t("textureNoEnabledLayers")}
        </p>
        <p className="mt-2 text-xs">
          {t("textureNativePreview", {
            bodies: input.preview.bodyCount,
            sourceTriangles: input.preview.sourceTriangleCount,
            triangles: input.preview.triangleCount,
          })}
        </p>
      </section>
    </AutomationReviewFrame>
  )
}
