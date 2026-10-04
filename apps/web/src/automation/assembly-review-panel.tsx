import type { AssemblyReviewInput } from "@vibeshape/automation-host/assembly-session-contract"
import type { AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import type { ReactNode } from "react"

const changeLabels: Record<AssemblyMutation["kind"], string> = {
  "assembly.upgrade": "upgradeAssembly",
  "definition.create": "createAssemblyDefinition",
  "definition.update": "updateAssemblyDefinition",
  "definition.relink": "relinkAssemblyDefinition",
  "definition.insert-pinned": "insertLibraryVersion",
  "definition.relink-pinned": "relinkLibraryDefinition",
  "definition.detach-library": "detachLibraryDefinition",
  "definition.remove": "removeAssemblyDefinition",
  "instance.create": "createAssemblyInstance",
  "instance.update": "updateAssemblyInstance",
  "instance.remove": "removeAssemblyInstance",
  "joint.create": "createAssemblyJoint",
  "joint.update": "updateAssemblyJoint",
  "joint.remove": "removeAssemblyJoint",
}
function target(change: AssemblyMutation) {
  if ("definition" in change) return change.definition.name
  if ("instance" in change) return change.instance.name
  if ("joint" in change) return change.joint.id
  if ("definitionId" in change) return change.definitionId
  if ("instanceId" in change) return change.instanceId
  if ("jointId" in change) return change.jointId
  return null
}
export function AssemblyAutomationReviewPanel({
  input,
  client,
  diagnostic,
  actions,
}: {
  input: AssemblyReviewInput
  client: string
  diagnostic: ReactNode
  actions: ReactNode
}) {
  const t = useTranslations("app.shell.taskPanel.automationReview")
  const kinematics = input.preview?.inspection.kinematics
  return (
    <section
      aria-label={t("title")}
      className="grid h-full max-h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-l bg-panel"
    >
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">{t("title")}</h2>
      </header>
      <section
        aria-label={t("changes")}
        className="min-h-0 min-w-0 overflow-auto overscroll-contain p-4"
      >
        {diagnostic}
        <p className="text-xs text-muted-foreground">
          {t(input.kind === "assembly" ? "assemblyReviewDescription" : "libraryReviewDescription")}
        </p>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt>{t("client")}</dt>
            <dd className="break-all">{client}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("document")}</dt>
            <dd className="break-words">{input.documentName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t("baseRevision")}</dt>
            <dd>{input.draft.baseRevision}</dd>
          </div>
        </dl>
        <ul className="mt-4 grid gap-2 text-xs">
          {input.changes.map((change, index) => (
            <li key={`${change.kind}:${index}`} className="break-words rounded border p-2">
              <div className="font-medium">{t(changeLabels[change.kind])}</div>
              {target(change) ? <div>{t("target", { target: target(change) ?? "" })}</div> : null}
              {"joint" in change ? (
                <div>{t("assemblyJointKind", { kind: change.joint.kind })}</div>
              ) : null}
            </li>
          ))}
          {input.library ? (
            <li className="break-words rounded border p-2">
              <div className="font-medium">
                {t(
                  input.library.operation === "save"
                    ? "saveLibraryDefinition"
                    : "updateLibraryMetadata",
                )}
              </div>
              <div>{t("nameValue", { name: input.library.name })}</div>
              <div>{t("libraryTags", { tags: input.library.tags.join(", ") })}</div>
              <div className="break-all">{t("target", { target: input.library.itemId })}</div>
            </li>
          ) : null}
        </ul>
        {input.preview ? (
          <section className="mt-4 border-t pt-3">
            <h3 className="text-xs font-medium">{t("assemblyExactPreview")}</h3>
            <p className="mt-2 text-xs">
              {t("assemblyOccurrenceCount", { count: input.preview.inspection.occurrences.length })}
            </p>
            {kinematics ? (
              <p className="mt-2 text-xs">
                {t("assemblyDof", { count: kinematics.degreesOfFreedom })}
              </p>
            ) : null}
            {kinematics?.redundant ? (
              <p className="mt-2 text-xs">{t("assemblyRedundant")}</p>
            ) : null}
          </section>
        ) : null}
      </section>
      <div className="border-t px-4 py-3">{actions}</div>
    </section>
  )
}
