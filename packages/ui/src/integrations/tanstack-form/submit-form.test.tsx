import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it } from "bun:test"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { submitForm, useAppForm } from "./index"

afterEach(cleanup)

function deferred() {
  let resolve = () => {}
  let reject = (_reason: unknown) => {}
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

it("joins concurrent programmatic submissions through validation and save settlement", async () => {
  const validation = deferred()
  const save = deferred()
  const onSubmit = vi.fn(() => save.promise)
  const { result } = renderHook(() =>
    useAppForm({
      defaultValues: { name: "Bracket" },
      validators: {
        onSubmitAsync: async () => {
          await validation.promise
          return undefined
        },
      },
      onSubmit,
    }),
  )
  let first = Promise.resolve()
  let history = Promise.resolve()
  act(() => {
    first = submitForm(result.current)
    history = submitForm(result.current)
  })
  expect(onSubmit).not.toHaveBeenCalled()
  await act(async () => validation.resolve())
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  let historyFinished = false
  void history.then(() => {
    historyFinished = true
  })
  expect(historyFinished).toBe(false)
  expect(result.current.state.isSubmitting).toBe(true)
  await act(async () => {
    save.resolve()
    await Promise.all([first, history])
  })
  expect(historyFinished).toBe(true)
  expect(result.current.state.isSubmitting).toBe(false)
})

it("releases joined callers after rejection and allows a corrected retry", async () => {
  const failedSave = deferred()
  const onSubmit = vi
    .fn()
    .mockImplementationOnce(() => failedSave.promise)
    .mockResolvedValue(undefined)
  const { result } = renderHook(() => useAppForm({ defaultValues: { name: "Bracket" }, onSubmit }))
  let submissions = Promise.resolve<PromiseSettledResult<void>[]>([])
  act(() => {
    submissions = Promise.allSettled([submitForm(result.current), submitForm(result.current)])
  })
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  await act(async () => {
    failedSave.reject(new Error("Save failed"))
    await submissions
  })
  expect(result.current.state.isSubmitting).toBe(false)
  await act(async () => submitForm(result.current))
  expect(onSubmit).toHaveBeenCalledTimes(2)
})
