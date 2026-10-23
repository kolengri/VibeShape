import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { ViewportGridItem } from "../shell/viewport-grid"
import { BrowserProjectAssistant } from "./browser-project-assistant"
import type { getNativeAssistant } from "./native-assistant-bridge"
import { NativeProjectAssistant } from "./native-project-assistant"

type Presentation = {
  open: boolean
  id: string
  toggle: () => void
  close: () => void
  button: RefObject<HTMLButtonElement | null>
}
const PresentationContext = createContext<Presentation | null>(null)

export function AssistantPresentationProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const toggle = useCallback(() => setOpen((value) => !value), [])
  const close = useCallback(() => {
    setOpen(false)
    button.current?.focus()
  }, [])
  const presentation = useMemo(
    () => ({ open, id, button, toggle, close }),
    [open, id, toggle, close],
  )
  return <PresentationContext value={presentation}>{children}</PresentationContext>
}

function useAssistantPresentation() {
  const presentation = useContext(PresentationContext)
  if (!presentation) throw new Error("Assistant presentation requires its provider.")
  return presentation
}

export function ProjectAssistantToggle() {
  const t = useTranslations("app.assistant")
  const { button, open, id, toggle } = useAssistantPresentation()
  return (
    <Button
      ref={button}
      size="sm"
      variant="ghost"
      aria-expanded={open}
      aria-controls={id}
      onClick={toggle}
    >
      {t("title")}
    </Button>
  )
}

export function ProjectAssistantPanel({
  bridge,
  controller,
  onCaptureView,
}: {
  bridge: ReturnType<typeof getNativeAssistant>
  controller: DocumentControllerState
  onCaptureView: () => Promise<File | null>
}) {
  const { open, id, close } = useAssistantPresentation()
  return (
    <ViewportGridItem
      id="workspace-assistant"
      area="right"
      order={100}
      visible={open}
      fullHeight
      width={420}
      minWidth={280}
      maxWidth={420}
      mobile={{ below: 640, area: "bottom", height: "45svh" }}
    >
      <div id={id} className="contents">
        {bridge ? (
          <NativeProjectAssistant
            bridge={bridge}
            controller={controller}
            open={open}
            onClose={close}
            onCaptureView={onCaptureView}
          />
        ) : (
          <BrowserProjectAssistant
            controller={controller}
            open={open}
            onClose={close}
            onCaptureView={onCaptureView}
          />
        )}
      </div>
    </ViewportGridItem>
  )
}
