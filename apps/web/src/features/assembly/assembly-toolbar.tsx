import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import {
  AssemblyInstanceIcon,
  AssemblyJointIcon,
  Box,
  ConstraintFixedIcon,
  Ellipsis,
  Link2,
  MotionStudyIcon,
  Pencil,
  RigidGroupIcon,
  Trash2,
} from "@vibeshape/ui/components/icons"
import { Toolbar, ToolbarButton } from "@vibeshape/ui/components/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import type { ReactNode } from "react"
import { AssemblyExportDialog } from "./assembly-export-dialog"
import { assemblyMotionCoordinates } from "./assembly-motion"
import type { AssemblyWorkspaceView } from "./use-assembly-workspace"

function IconAction({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolbarButton asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {icon}
          </Button>
        </ToolbarButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
function CreateMenu({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  const unavailable =
    view.taskActionsDisabled || !view.inspection.inspection || view.assembly.instances.length < 2
  return (
    <DropdownMenuGroup aria-label={t("createMenu")}>
      <p role="presentation" className="px-2 py-1 text-xs text-muted-foreground">
        {t("createMenu")}
      </p>
      <DropdownMenuItem disabled={unavailable} onSelect={() => view.openTask("asBuiltJoint")}>
        <AssemblyJointIcon aria-hidden="true" />
        {t("asBuiltJoint")}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={unavailable} onSelect={() => view.openTask("rigidGroup")}>
        <RigidGroupIcon aria-hidden="true" />
        {t("rigidGroup")}
      </DropdownMenuItem>
      {view.assembly.schemaVersion === 1 && (
        <DropdownMenuItem
          disabled={view.disabled || view.inspection.pending}
          onSelect={() => void view.upgrade()}
        >
          <Link2 aria-hidden="true" />
          {t("generalMates")}
        </DropdownMenuItem>
      )}
    </DropdownMenuGroup>
  )
}
function MotionMenu({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  const driven = view.assembly.joints.filter((joint) => assemblyMotionCoordinates(joint).length)
  return (
    <DropdownMenuGroup aria-label={t("motionMenu")}>
      <p role="presentation" className="px-2 py-1 text-xs text-muted-foreground">
        {t("motionMenu")}
      </p>
      <DropdownMenuItem
        disabled={view.taskActionsDisabled || !driven.length}
        onSelect={() => view.openStudy(null)}
      >
        <MotionStudyIcon aria-hidden="true" />
        {t("motionNewStudy")}
      </DropdownMenuItem>
      {!driven.length && (
        <p className="px-2 py-1 text-xs text-muted-foreground">{t("motionStudyEmpty")}</p>
      )}
      {view.assembly.motionStudies?.map((study) => (
        <DropdownMenuItem
          key={study.id}
          disabled={view.taskActionsDisabled}
          onSelect={() => view.openStudy(study.id)}
        >
          <MotionStudyIcon aria-hidden="true" />
          {study.name}
        </DropdownMenuItem>
      ))}
      {driven.map((joint) => {
        const parent = view.assembly.instances.find(({ id }) => id === joint.parentInstanceId)
        const child = view.assembly.instances.find(({ id }) => id === joint.childInstanceId)
        return (
          <DropdownMenuItem
            key={joint.id}
            disabled={view.taskActionsDisabled}
            onSelect={() => view.openMotion(joint.id)}
          >
            <AssemblyJointIcon aria-hidden="true" />
            {t("driveJointBetween", { parent: parent?.name ?? "", child: child?.name ?? "" })}
          </DropdownMenuItem>
        )
      })}
    </DropdownMenuGroup>
  )
}
function MotionActions({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <ToolbarButton asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={t("motionStudies")}
                dropdown
                disabled={view.taskActionsDisabled}
              >
                <MotionStudyIcon aria-hidden="true" />
                {t("motionStudies")}
              </Button>
            </ToolbarButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("motionStudies")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
        <MotionMenu view={view} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
function InstanceMenu({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  const instance = view.selected.instance
  if (!instance) return null
  const joints = view.assembly.joints.filter(
    ({ parentInstanceId, childInstanceId }) =>
      childInstanceId === instance.id ||
      (view.assembly.schemaVersion === 2 && parentInstanceId === instance.id),
  )
  return (
    <DropdownMenuGroup aria-label={t("selectedItemActions", { name: instance.name })}>
      <DropdownMenuSeparator />
      <p role="presentation" className="px-2 py-1 text-xs text-muted-foreground">
        {instance.name}
      </p>
      <DropdownMenuItem
        disabled={view.disabled}
        onSelect={() => view.openTask("editInstance", instance.id)}
      >
        <Pencil aria-hidden="true" />
        {t("editInstance")}
      </DropdownMenuItem>
      {joints.map((joint) => {
        const otherId =
          joint.parentInstanceId === instance.id ? joint.childInstanceId : joint.parentInstanceId
        const other = view.assembly.instances.find(({ id }) => id === otherId)
        return (
          <DropdownMenuItem
            key={joint.id}
            disabled={view.disabled}
            onSelect={() => view.openTask("editJoint", joint.id)}
          >
            <AssemblyJointIcon aria-hidden="true" />
            {t("editJointWith", { kind: t(joint.kind), instance: other?.name ?? "" })}
          </DropdownMenuItem>
        )
      })}
      {!instance.grounded && (
        <DropdownMenuItem disabled={view.disabled} onSelect={() => void view.ground(instance)}>
          <ConstraintFixedIcon aria-hidden="true" />
          {t("groundInstance")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        disabled={view.disabled}
        onSelect={() => view.onRemove("instance", instance.id, instance.name)}
      >
        <Trash2 aria-hidden="true" />
        {t("removeInstance")}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}
function DefinitionMenu({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  const definition = view.selected.definition
  if (!definition) return null
  return (
    <DropdownMenuGroup aria-label={t("selectedItemActions", { name: definition.name })}>
      <DropdownMenuSeparator />
      <p role="presentation" className="px-2 py-1 text-xs text-muted-foreground">
        {definition.name}
      </p>
      <DropdownMenuItem
        disabled={view.disabled}
        onSelect={() => view.openTask("editDefinition", definition.id)}
      >
        <Pencil aria-hidden="true" />
        {t("editDefinition")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={view.disabled}
        onSelect={() => view.openTask("relinkDefinition", definition.id)}
      >
        <Link2 aria-hidden="true" />
        {t("relinkDefinition")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={view.disabled}
        onSelect={() => view.onRemove("definition", definition.id, definition.name)}
      >
        <Trash2 aria-hidden="true" />
        {t("removeDefinition")}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}
function MoreActions({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <ToolbarButton asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("moreActions")}
                dropdown
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </ToolbarButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("moreActions")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
        <CreateMenu view={view} />
        <DropdownMenuSeparator />
        <InstanceMenu view={view} />
        <DefinitionMenu view={view} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export function AssemblyToolbar({ view }: { view: AssemblyWorkspaceView }) {
  const t = useTranslations("app.assembly")
  return (
    <Toolbar aria-label={t("actionsLabel")} className="flex-wrap gap-1">
      <IconAction
        label={t("createDefinition")}
        icon={<Box aria-hidden="true" />}
        disabled={view.disabled || !view.sources.length}
        onClick={() => view.openTask("createDefinition")}
      />
      <IconAction
        label={t("addInstance")}
        icon={<AssemblyInstanceIcon aria-hidden="true" />}
        disabled={view.disabled || !view.assembly.definitions.length}
        onClick={() => view.openTask("addInstance")}
      />
      <IconAction
        label={t("addJoint")}
        icon={<AssemblyJointIcon aria-hidden="true" />}
        disabled={view.disabled || !view.assembly.instances.length}
        onClick={() => view.openTask("addJoint")}
      />
      <AssemblyExportDialog
        compact
        key={view.documentKey}
        instances={view.assembly.instances}
        selectedId={view.selected.activeId}
        inspection={view.inspection.inspection}
        disabled={view.disabled || view.inspection.pending}
      />
      <MotionActions view={view} />
      <MoreActions view={view} />
    </Toolbar>
  )
}
