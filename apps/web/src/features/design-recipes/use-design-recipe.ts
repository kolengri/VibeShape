import {
  emitDesignRecipeTypeScript,
  exportDesignRecipe,
  type MacroRecording,
  startMacroRecording,
  stopMacroRecording,
} from "@vibeshape/application/design-recipes"
import { useTranslations } from "@vibeshape/i18n"
import { useEffect, useRef, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { portableDocumentStem } from "../../document/document-export"
import { applyDesignRecipePreview, previewDesignRecipe } from "./design-recipe-preview"
import { runDesignScript } from "./script-client"
import { designScriptExample } from "./script-example"

export function useDesignRecipe(
  controller: DocumentControllerState,
  onOpenChange: (open: boolean) => void,
) {
  const t = useTranslations("app.designRecipes")
  const [code, setCode] = useState("")
  const [recording, setRecording] = useState<MacroRecording | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<"preview" | "apply" | null>(null)
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof previewDesignRecipe>> | null>(
    null,
  )
  const operation = useRef<AbortController | null>(null)
  const locked = useRef(false)
  const snapshot = controller.authoredSnapshot
  const writable =
    controller.status === "ready" &&
    controller.report?.mode === "read-write" &&
    controller.saveStatus !== "saving"
  useEffect(() => () => operation.current?.abort(), [])
  const fail = (value: unknown) => setError(value instanceof Error ? value.message : t("failed"))
  const capture = () => {
    const result = exportDesignRecipe(snapshot)
    setError(null)
    setPrepared(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setCode(emitDesignRecipeTypeScript(result.recipe))
    setStatus(t("exportReady"))
  }
  const record = () => {
    const result = startMacroRecording(snapshot)
    setError(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setRecording(result.recording)
    setStatus(t("recording"))
    onOpenChange(false)
  }
  const stop = () => {
    if (!recording) return
    const result = stopMacroRecording(recording, snapshot)
    setRecording(null)
    setError(null)
    setPrepared(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setCode(emitDesignRecipeTypeScript(result.recipe))
    setStatus(t("recorded", { count: result.recordedCount, dependencies: result.dependencyCount }))
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/typescript;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${portableDocumentStem(controller.report?.snapshot.name ?? "design")}.ts`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const preview = async () => {
    if (locked.current) return
    locked.current = true
    const abort = new AbortController()
    operation.current = abort
    setPhase("preview")
    setError(null)
    setPrepared(null)
    setStatus(null)
    try {
      const recipe = await runDesignScript(code, abort.signal)
      const result = await previewDesignRecipe(recipe, abort.signal)
      setPrepared(result)
      setStatus(
        t("previewReady", {
          features: result.recipe.features.length,
          sketches: result.recipe.sketches.length,
          variables: result.recipe.variables.length,
        }),
      )
    } catch (reason) {
      fail(reason)
    } finally {
      locked.current = false
      operation.current = null
      setPhase(null)
    }
  }
  const apply = async () => {
    if (locked.current || !prepared) return
    locked.current = true
    setPhase("apply")
    setError(null)
    try {
      await applyDesignRecipePreview(prepared)
      setPrepared(null)
      setStatus(t("applied"))
    } catch (reason) {
      fail(reason)
    } finally {
      locked.current = false
      setPhase(null)
    }
  }
  const edit = (value: string) => {
    setCode(value)
    setPrepared(null)
    setStatus(null)
    setError(null)
  }
  const example = () => edit(designScriptExample)
  const discard = () => {
    setRecording(null)
    setStatus(null)
  }
  const close = () => {
    if (phase === "preview") operation.current?.abort()
    else onOpenChange(false)
  }
  const changeOpen = (next: boolean) => {
    if (!phase) onOpenChange(next)
  }
  const current =
    prepared?.documentId === snapshot?.id && prepared?.baseRevision === snapshot?.revision
  return {
    code,
    recording,
    status,
    error,
    phase,
    prepared,
    writable,
    current,
    capture,
    record,
    stop,
    download,
    preview,
    apply,
    edit,
    discard,
    close,
    changeOpen,
    example,
  }
}
