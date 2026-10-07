import type { AssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"

export function AssemblyTree({
  assembly,
  selectedId,
  selectedDefinitionId,
  onSelectInstance,
  onSelectDefinition,
}: {
  assembly: AssemblyAuthority
  selectedId: string | null
  selectedDefinitionId: string | null
  onSelectInstance: (id: string) => void
  onSelectDefinition: (id: string) => void
}) {
  const t = useTranslations("app.assembly")
  return (
    <aside className="h-full overflow-y-auto p-3" aria-label={t("tree")}>
      <h2 className="mb-2 text-sm font-semibold">{t("instances")}</h2>
      <div className="grid gap-1">
        {assembly.instances.map((instance) => (
          <Button
            size="content"
            key={instance.id}
            type="button"
            variant={instance.id === selectedId ? "secondary" : "ghost"}
            className="justify-start text-left"
            aria-pressed={instance.id === selectedId}
            onClick={() => onSelectInstance(instance.id)}
            data-assembly-instance-id={instance.id}
          >
            <span className="grid min-w-0 gap-0.5">
              <span className="break-words">{instance.name}</span>
              <span className="text-xs text-muted-foreground">
                {t(instance.grounded ? "grounded" : "attached")}
              </span>
            </span>
          </Button>
        ))}
        {!assembly.instances.length && (
          <p className="text-xs text-muted-foreground">{t("emptyInstances")}</p>
        )}
      </div>
      <h2 className="mb-2 mt-5 text-sm font-semibold">{t("definitions")}</h2>
      <div className="grid gap-1">
        {assembly.definitions.map((definition) => (
          <Button
            size="content"
            key={definition.id}
            type="button"
            variant={definition.id === selectedDefinitionId ? "secondary" : "ghost"}
            className="justify-start text-left"
            aria-pressed={definition.id === selectedDefinitionId}
            onClick={() => onSelectDefinition(definition.id)}
            data-assembly-definition-id={definition.id}
          >
            <span className="grid min-w-0 gap-0.5">
              <span className="break-words">{definition.name}</span>
              <span className="text-xs text-muted-foreground">
                {t("pinRevision", { revision: definition.pinRevision })}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </aside>
  )
}
