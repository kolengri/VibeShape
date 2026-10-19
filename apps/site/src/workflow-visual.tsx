import { useTranslations } from "@vibeshape/i18n"
import { cn } from "@vibeshape/ui/lib/cn"
import WorkflowModel from "./workflow-model"

export type WorkflowStage = "sketch" | "shape" | "export"

function ModelPreview() {
  const t = useTranslations("workflow")
  return (
    <WorkflowModel
      labels={{
        title: t("model.title"),
        hint: t("model.hint"),
        fit: t("model.fit"),
        isometric: t("model.isometric"),
        front: t("model.front"),
        top: t("model.top"),
        right: t("model.right"),
        loading: t("model.loading"),
        unavailable: t("model.unavailable"),
      }}
    />
  )
}

export function WorkflowVisual({ stage }: { stage: WorkflowStage }) {
  const t = useTranslations("workflow")
  return (
    <div
      data-stage={stage}
      className={cn(
        "workflow-visual min-w-0 border-t border-border md:border-l md:border-t-0",
        stage === "shape"
          ? "p-4 sm:p-6"
          : "blueprint-grid flex min-h-80 flex-col items-center justify-center gap-7 p-8",
      )}
      aria-hidden={stage !== "shape"}
    >
      {stage === "sketch" ? (
        <>
          <div className="relative flex h-32 w-48 items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
            <div className="size-12 rounded-full border-2 border-primary" />
            <span className="absolute -top-6 font-mono text-xs text-primary">80 mm</span>
            <span className="absolute -bottom-6 font-mono text-xs text-primary">Ø 20 mm</span>
          </div>
          <p className="mt-6 font-mono text-[11px] text-muted-foreground">{t("dimensions")}</p>
        </>
      ) : stage === "shape" ? (
        <ModelPreview />
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
  )
}
