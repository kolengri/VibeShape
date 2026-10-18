import type { AssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  ChevronDown,
  CircleDashed,
  CirclePlay,
  ConstraintFixedIcon,
  Cuboid,
  Layers3,
  Link2,
} from "@vibeshape/ui/components/icons"
import { Input } from "@vibeshape/ui/components/input"
import { cn } from "@vibeshape/ui/lib/cn"
import { type ReactNode, useId, useState } from "react"
import {
  modelBrowserChildRow,
  modelBrowserCount,
  modelBrowserGroupRow,
  modelBrowserItem,
  modelBrowserSelectedRow,
} from "../../shell/model-browser-styles"

type AssemblyTreeProps = {
  assembly: AssemblyAuthority
  selectedId: string | null
  selectedDefinitionId: string | null
  onSelectInstance: (id: string) => void
  onSelectDefinition: (id: string) => void
  onSelectJoint?: ((id: string) => void) | undefined
  onDriveJoint?: ((id: string) => void) | undefined
  motionDisabled?: boolean | undefined
}

function AssemblySection({
  title,
  count,
  icon,
  children,
}: {
  title: string
  count: number
  icon: ReactNode
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(true)
  const id = useId()
  return (
    <section className="min-w-0">
      <h2>
        <Button
          size="sm"
          variant="ghost"
          className={modelBrowserGroupRow}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 shrink-0", !expanded && "-rotate-90")}
          />
          {icon}
          <span className="truncate">{title}</span>
          <span aria-hidden="true" className={modelBrowserCount}>
            {count}
          </span>
        </Button>
      </h2>
      <div id={id} hidden={!expanded} className="min-w-0">
        {children}
      </div>
    </section>
  )
}

function matchesFilter(filter: string, ...labels: (string | undefined)[]) {
  return labels.some((label) => label?.toLocaleLowerCase().includes(filter))
}

function AssemblyInstances({
  assembly,
  selectedId,
  onSelectInstance,
  filter,
}: Pick<AssemblyTreeProps, "assembly" | "selectedId" | "onSelectInstance"> & { filter: string }) {
  const t = useTranslations("app.assembly")
  const instances = assembly.instances.filter((instance) =>
    matchesFilter(
      filter,
      instance.name,
      assembly.definitions.find(({ id }) => id === instance.definitionId)?.name,
    ),
  )
  return (
    <AssemblySection
      title={t("instances")}
      count={instances.length}
      icon={<Cuboid aria-hidden="true" className="size-4 text-muted-foreground" />}
    >
      <ul className="grid">
        {instances.map((instance) => {
          const definition = assembly.definitions.find(({ id }) => id === instance.definitionId)
          const connected = assembly.joints.some(
            ({ parentInstanceId, childInstanceId }) =>
              parentInstanceId === instance.id || childInstanceId === instance.id,
          )
          const Icon = instance.grounded ? ConstraintFixedIcon : connected ? Link2 : CircleDashed
          return (
            <li key={instance.id}>
              <Button
                size="content"
                variant="ghost"
                className={cn(
                  modelBrowserChildRow,
                  "h-auto min-h-12 w-full py-1 text-left",
                  instance.id === selectedId && modelBrowserSelectedRow,
                )}
                aria-pressed={instance.id === selectedId}
                onClick={() => onSelectInstance(instance.id)}
                title={definition ? t("instanceDefinition", { name: definition.name }) : undefined}
                data-assembly-instance-id={instance.id}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate" title={instance.name}>
                    {instance.name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t(instance.grounded ? "grounded" : connected ? "attached" : "freeInstance")}
                  </span>
                  {definition && (
                    <span className="sr-only">
                      {t("instanceDefinition", { name: definition.name })}
                    </span>
                  )}
                </span>
              </Button>
            </li>
          )
        })}
      </ul>
      {!instances.length && (
        <p className="py-2 pl-14 pr-2 text-xs text-muted-foreground">
          {t(filter ? "noBrowserMatches" : "emptyInstances")}
        </p>
      )}
    </AssemblySection>
  )
}

function AssemblyDefinitions({
  assembly,
  selectedDefinitionId,
  onSelectDefinition,
  filter,
}: Pick<AssemblyTreeProps, "assembly" | "selectedDefinitionId" | "onSelectDefinition"> & {
  filter: string
}) {
  const t = useTranslations("app.assembly")
  const definitions = assembly.definitions.filter(({ name }) => matchesFilter(filter, name))
  return (
    <AssemblySection
      title={t("definitions")}
      count={definitions.length}
      icon={<Layers3 aria-hidden="true" className="size-4 text-muted-foreground" />}
    >
      <ul className="grid">
        {definitions.map((definition) => (
          <li key={definition.id}>
            <Button
              size="content"
              variant="ghost"
              className={cn(
                modelBrowserChildRow,
                "h-auto min-h-12 w-full py-1 text-left",
                definition.id === selectedDefinitionId && modelBrowserSelectedRow,
              )}
              aria-pressed={definition.id === selectedDefinitionId}
              onClick={() => onSelectDefinition(definition.id)}
              data-assembly-definition-id={definition.id}
            >
              <Cuboid aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate" title={definition.name}>
                  {definition.name}
                </span>
                <span className="flex min-w-0 gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {t("pinRevision", { revision: definition.pinRevision })}
                  </span>
                  <span className="truncate">
                    {t("definitionOccurrences", {
                      count: assembly.instances.filter(
                        ({ definitionId }) => definitionId === definition.id,
                      ).length,
                    })}
                  </span>
                </span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {!definitions.length && (
        <p className="py-2 pl-14 pr-2 text-xs text-muted-foreground">
          {t(filter ? "noBrowserMatches" : "emptyDefinitions")}
        </p>
      )}
    </AssemblySection>
  )
}

function AssemblyJoints({
  assembly,
  onSelectJoint,
  onDriveJoint,
  motionDisabled,
  filter,
}: Pick<AssemblyTreeProps, "assembly" | "onSelectJoint" | "onDriveJoint" | "motionDisabled"> & {
  filter: string
}) {
  const t = useTranslations("app.assembly")
  const joints = assembly.joints
    .map((joint) => {
      const parent =
        assembly.instances.find(({ id }) => id === joint.parentInstanceId)?.name ??
        t("unknownInstance")
      const child =
        assembly.instances.find(({ id }) => id === joint.childInstanceId)?.name ??
        t("unknownInstance")
      return { joint, parent, child, kind: t(joint.kind) }
    })
    .filter(({ parent, child, kind }) => matchesFilter(filter, parent, child, kind))
  return (
    <AssemblySection
      title={t("joints")}
      count={joints.length}
      icon={<Link2 aria-hidden="true" className="size-4 text-muted-foreground" />}
    >
      <ul className="grid">
        {joints.map(({ joint, parent, child, kind }) => (
          <li key={joint.id} className={modelBrowserItem} data-assembly-joint-id={joint.id}>
            <Button
              size="content"
              variant="ghost"
              className={cn(modelBrowserChildRow, "h-auto min-h-12 flex-1 py-1 text-left")}
              disabled={!onSelectJoint || motionDisabled}
              onClick={() => onSelectJoint?.(joint.id)}
              aria-label={t("jointBetween", { kind, parent, child })}
            >
              <Link2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span>{kind}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {t("jointEndpoints", { parent, child })}
                </span>
              </span>
            </Button>
            {onDriveJoint && joint.kind !== "fixed" && joint.kind !== "ball" && (
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={motionDisabled}
                aria-label={t("driveJointBetween", { parent, child })}
                onClick={() => onDriveJoint(joint.id)}
              >
                <CirclePlay aria-hidden="true" className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!joints.length && (
        <p className="py-2 pl-14 pr-2 text-xs text-muted-foreground">
          {t(filter ? "noBrowserMatches" : "emptyJoints")}
        </p>
      )}
    </AssemblySection>
  )
}

export function AssemblyTree(props: AssemblyTreeProps) {
  const t = useTranslations("app.assembly")
  const [query, setQuery] = useState("")
  const filter = query.trim().toLocaleLowerCase()
  return (
    <aside
      className="grid h-full content-start gap-1 overflow-y-auto bg-panel p-2"
      aria-label={t("tree")}
    >
      <Input
        className="mb-2 h-8"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        aria-label={t("filterBrowser")}
        placeholder={t("filterBrowser")}
      />
      <AssemblyInstances {...props} filter={filter} />
      <AssemblyJoints {...props} filter={filter} />
      <AssemblyDefinitions {...props} filter={filter} />
    </aside>
  )
}
