import { useTranslations } from "@vibeshape/i18n"
import { useReportBlockingActivity } from "@vibeshape/ui/components/activity"
import { createContext, type ReactNode, useContext, useState } from "react"
import { useStore } from "zustand"
import { createProjectTabsStore } from "./project-tabs-store"

type ProjectTabsStore = ReturnType<typeof createProjectTabsStore>
const ProjectTabsContext = createContext<ProjectTabsStore | null>(null)

export function ProjectTabsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createProjectTabsStore())
  return (
    <ProjectTabsContext value={store}>
      <ProjectTabsActivity />
      {children}
    </ProjectTabsContext>
  )
}

export function useProjectTabsStore() {
  const store = useContext(ProjectTabsContext)
  if (!store) throw new Error("Project tabs require ProjectTabsProvider.")
  return store
}

export function useProjectTabs() {
  return useStore(useProjectTabsStore())
}

function ProjectTabsActivity() {
  const t = useTranslations("app.projectTabs")
  const closing = useStore(useProjectTabsStore(), (state) => state.closing)
  useReportBlockingActivity(closing, t("closing"))
  return null
}
