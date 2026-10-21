import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  ASSISTANT_MAX_ATTACHMENT_TOTAL_BYTES,
  ASSISTANT_MAX_ATTACHMENTS,
  ASSISTANT_MAX_IMAGE_ATTACHMENT_BYTES,
} from "@vibeshape/automation-api/assistant"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { useState } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import {
  AssistantComposer,
  type AssistantComposerDraft,
  type AssistantComposerProps,
} from "./assistant-composer"

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Composer(props: Partial<AssistantComposerProps>) {
  const [draft, setDraft] = useState<AssistantComposerDraft>({
    text: "Describe this",
    attachments: [],
  })
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <AssistantComposer
          busy={false}
          canSend
          onSend={async () => true}
          onCancel={async () => {}}
          attachmentCapabilities={{ text: true, images: true }}
          {...props}
          draft={draft}
          onDraftChange={setDraft}
        />
      </TooltipProvider>
    </I18nProvider>
  )
}

function message() {
  return screen.getByRole("region", { name: "Message" })
}
function textbox() {
  return screen.getByRole("textbox", { name: "Message" })
}
function send() {
  return screen.getByRole("button", { name: "Send" })
}
function capture() {
  return screen.getByRole("button", { name: "Attach current view" })
}
function textFile(name = "notes.txt") {
  return new File(["width=42"], name, { type: "text/plain" })
}
function imageFile() {
  return new File([new Uint8Array([1, 2, 3])], "current-view.png", { type: "image/png" })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function transfer(files: File[], types = ["Files"]) {
  return { types, files, items: files.map((file) => ({ kind: "file", type: file.type })) }
}
function dropEvent(files: File[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: transfer(files) })
  return event
}
function drop(files: File[]) {
  const event = dropEvent(files)
  fireEvent(message(), event)
  return event
}
function delayedReads() {
  const readers: { onload: (() => void) | null; result: ArrayBuffer }[] = []
  vi.stubGlobal(
    "FileReader",
    class {
      onload = null
      onerror = null
      onabort = null
      result = new Uint8Array([1, 2, 3]).buffer
      readAsArrayBuffer() {
        readers.push(this)
      }
    },
  )
  return readers
}
function sizedImage(name: string, size: number) {
  const file = new File(["image"], name, { type: "image/png" })
  Object.defineProperty(file, "size", { value: size })
  return file
}

it("keeps nested file drag feedback visible until the outer leave and leaves text drags alone", () => {
  render(<Composer />)
  const dataTransfer = transfer([textFile()])
  expect(fireEvent.dragEnter(message(), { dataTransfer })).toBe(false)
  expect(screen.getByRole("status").textContent).toBe("Drop files to attach them to this message.")
  fireEvent.dragEnter(textbox(), { dataTransfer })
  fireEvent.dragLeave(textbox(), { dataTransfer })
  expect(screen.getByRole("status")).toBeTruthy()
  expect(fireEvent.dragOver(textbox(), { dataTransfer })).toBe(false)
  fireEvent.dragLeave(message(), { dataTransfer })
  expect(screen.queryByRole("status")).toBeNull()
  const textTransfer = transfer([], ["text/plain"])
  expect(fireEvent.dragEnter(textbox(), { dataTransfer: textTransfer })).toBe(true)
  expect(fireEvent.dragOver(textbox(), { dataTransfer: textTransfer })).toBe(true)
  expect(fireEvent.drop(textbox(), { dataTransfer: textTransfer })).toBe(true)
  expect(screen.queryByRole("status")).toBeNull()
})

it.each([{ canSend: false }, { attachmentCapabilities: { text: false, images: false } }])(
  "prevents file navigation and propagation while attachments are unavailable: %j",
  (props) => {
    const outerDrop = vi.fn()
    render(
      <section aria-label="Outer file handler" onDrop={outerDrop}>
        <Composer {...props} />
      </section>,
    )
    const dataTransfer = transfer([textFile()])
    fireEvent.dragEnter(message(), { dataTransfer })
    expect(screen.getByRole("status").textContent).toContain("Files cannot be attached")
    expect(fireEvent.dragOver(textbox(), { dataTransfer })).toBe(false)
    expect(drop([textFile()]).defaultPrevented).toBe(true)
    expect(outerDrop).not.toHaveBeenCalled()
    expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
  },
)

it("uses the existing reader policies for dropped text, disabled images, invalid UTF-8, and oversized files", async () => {
  render(<Composer attachmentCapabilities={{ text: true, images: false }} />)
  drop([
    textFile(),
    imageFile(),
    new File([new Uint8Array([0xff])], "invalid.txt", { type: "text/plain" }),
    new File([new Uint8Array(2 * 1024 ** 2 + 1)], "large.txt", { type: "text/plain" }),
    new File(["%PDF"], "drawing.pdf", { type: "application/pdf" }),
  ])
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(4))
  expect(
    screen.getByText("current-view.png: this file type is not supported by this agent."),
  ).toBeTruthy()
  expect(
    screen.getByText("drawing.pdf: this file type is not supported by this agent."),
  ).toBeTruthy()
  expect(screen.getByText("invalid.txt is not valid UTF-8 text.")).toBeTruthy()
  expect(screen.getByText("large.txt exceeds the 2 MB attachment limit.")).toBeTruthy()
  expect(send().hasAttribute("disabled")).toBe(true)
  expect(screen.getByRole("button", { name: "Remove notes.txt" })).toBeTruthy()
})

it("reserves pending admissions across batched picker and drop events and frees capacity on removal", async () => {
  const readers = delayedReads()
  render(<Composer />)
  const input = screen.getByLabelText("Attach files", { selector: "input" })
  act(() => {
    fireEvent.change(input, {
      target: { files: [textFile("one.txt"), textFile("two.txt"), textFile("three.txt")] },
    })
    message().dispatchEvent(
      dropEvent([textFile("four.txt"), textFile("five.txt"), textFile("six.txt")]),
    )
    fireEvent.keyDown(textbox(), { key: "Enter", ctrlKey: true })
  })
  expect(
    screen.getByText(`Attach up to ${ASSISTANT_MAX_ATTACHMENTS} files per message.`),
  ).toBeTruthy()
  expect(readers).toHaveLength(3)
  expect(screen.queryByRole("button", { name: "Remove six.txt" })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: "Remove one.txt" }))
  drop([textFile("four.txt"), textFile("five.txt"), textFile("six.txt")])
  expect(readers).toHaveLength(6)
  await act(async () => {
    readers[0]?.onload?.()
  })
  expect(screen.queryByRole("button", { name: "Remove one.txt" })).toBeNull()
  expect(
    within(screen.getByRole("list", { name: "Attachments" })).getAllByRole("listitem"),
  ).toHaveLength(5)
})

it("applies the total byte budget to concurrent reads before starting another file reader", () => {
  const readers = delayedReads()
  render(<Composer />)
  const size = ASSISTANT_MAX_ATTACHMENT_TOTAL_BYTES / 3
  act(() => {
    message().dispatchEvent(dropEvent([sizedImage("one.png", size), sizedImage("two.png", size)]))
    message().dispatchEvent(dropEvent([sizedImage("three.png", size + 1)]))
  })
  expect(readers).toHaveLength(2)
  expect(screen.getByText("Attachments exceed the 12 MB total limit.")).toBeTruthy()
  drop([sizedImage("three.png", size)])
  expect(readers).toHaveLength(3)
})

it("blocks file admission and capture while sending without allowing browser navigation", async () => {
  const pending = deferred<boolean>()
  const onCaptureView = vi.fn().mockResolvedValue(imageFile())
  render(<Composer onSend={() => pending.promise} onCaptureView={onCaptureView} />)
  fireEvent.click(send())
  expect(drop([textFile()]).defaultPrevented).toBe(true)
  fireEvent.click(capture())
  expect(onCaptureView).not.toHaveBeenCalled()
  expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull()
  await act(async () => {
    pending.resolve(false)
  })
})

it.each([
  { attachmentCapabilities: { text: true, images: false } },
  { attachmentCapabilities: { text: false, images: false } },
])("hides capture when image capability is absent: %j", (props) => {
  const onCaptureView = vi.fn().mockResolvedValue(imageFile())
  render(<Composer {...props} onCaptureView={onCaptureView} />)
  expect(screen.queryByRole("button", { name: "Attach current view" })).toBeNull()
  expect(onCaptureView).not.toHaveBeenCalled()
})

it("requires an explicit capture callback and activation, preserves a null cancellation, and releases its lock", async () => {
  const pending = deferred<File | null>()
  const onCaptureView = vi.fn().mockReturnValue(pending.promise)
  const view = render(<Composer />)
  expect(screen.queryByRole("button", { name: "Attach current view" })).toBeNull()
  view.rerender(<Composer onCaptureView={onCaptureView} />)
  expect(onCaptureView).not.toHaveBeenCalled()
  act(() => {
    fireEvent.click(capture())
    fireEvent.click(capture())
  })
  expect(onCaptureView).toHaveBeenCalledTimes(1)
  expect(capture().getAttribute("aria-busy")).toBe("true")
  expect(send().hasAttribute("disabled")).toBe(true)
  await act(async () => {
    pending.resolve(null)
  })
  expect(capture().hasAttribute("disabled")).toBe(false)
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull()
  expect((textbox() as HTMLTextAreaElement).value).toBe("Describe this")
  expect(send().hasAttribute("disabled")).toBe(false)
})

it("reports capture failure without clearing the draft and permits keyboard retry with a thumbnail", async () => {
  const onCaptureView = vi
    .fn()
    .mockRejectedValueOnce(new Error("capture failed"))
    .mockResolvedValueOnce(imageFile())
  render(<Composer onCaptureView={onCaptureView} />)
  await userEvent.click(capture())
  expect(screen.getByRole("alert").textContent).toBe(
    "Could not capture the current view. Try again or attach an image file.",
  )
  expect((textbox() as HTMLTextAreaElement).value).toBe("Describe this")
  await act(async () => capture().focus())
  await userEvent.keyboard("{Enter}")
  await waitFor(() => expect(send().hasAttribute("disabled")).toBe(false))
  expect(onCaptureView).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole("alert")).toBeNull()
  const thumbnail = message().querySelector("img")
  expect(thumbnail?.getAttribute("src")).toBe("data:image/png;base64,AQID")
  expect(thumbnail?.getAttribute("alt")).toBe("")
  await userEvent.click(screen.getByRole("button", { name: "Remove current-view.png" }))
  expect(message().querySelector("img")).toBeNull()
})

it("keeps capture and reading single-flight, then queues the explicit image with the textarea description", async () => {
  const pending = deferred<File | null>()
  const readers = delayedReads()
  const onQueue = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const onSend = vi.fn()
  const onCaptureView = vi.fn(() => pending.promise)
  render(<Composer busy onQueue={onQueue} onSend={onSend} onCaptureView={onCaptureView} />)
  fireEvent.click(capture())
  fireEvent.change(textbox(), { target: { value: "Inspect this angle" } })
  fireEvent.keyDown(textbox(), { key: "Enter", ctrlKey: true })
  expect(onQueue).not.toHaveBeenCalled()
  await act(async () => {
    pending.resolve(imageFile())
  })
  expect(screen.getByRole("button", { name: "Queue message" }).hasAttribute("disabled")).toBe(true)
  expect(
    screen.getByRole("button", { name: "Remove current-view.png" }).hasAttribute("disabled"),
  ).toBe(false)
  expect(screen.getByText("current-view.png").parentElement?.getAttribute("aria-busy")).toBe("true")
  await act(async () => {
    readers[0]?.onload?.()
  })
  await userEvent.click(screen.getByRole("button", { name: "Queue message" }))
  expect(onQueue).toHaveBeenCalledWith("Inspect this angle", [
    {
      id: expect.any(String),
      name: "current-view.png",
      type: "image",
      mimeType: "image/png",
      data: "AQID",
    },
  ])
  expect(screen.getByRole("button", { name: "Remove current-view.png" })).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "Queue message" }))
  await waitFor(() => expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull())
  expect((textbox() as HTMLTextAreaElement).value).toBe("")
  expect(onSend).not.toHaveBeenCalled()
})

it("counts files dropped during capture before admitting its result", async () => {
  const pending = deferred<File | null>()
  render(<Composer onCaptureView={() => pending.promise} />)
  fireEvent.click(capture())
  drop(Array.from({ length: ASSISTANT_MAX_ATTACHMENTS }, (_, index) => textFile(`${index}.txt`)))
  await act(async () => {
    pending.resolve(imageFile())
  })
  expect(screen.getByText("Attach up to 5 files per message.")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Remove current-view.png" })).toBeNull()
})

it("removes a captured image while its reader is pending without resurrecting it", async () => {
  const readers = delayedReads()
  render(<Composer onCaptureView={async () => imageFile()} />)
  await userEvent.click(capture())
  await userEvent.click(screen.getByRole("button", { name: "Remove current-view.png" }))
  await act(async () => {
    readers[0]?.onload?.()
  })
  expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull()
  expect(message().querySelector("img")).toBeNull()
  expect((textbox() as HTMLTextAreaElement).value).toBe("Describe this")
  expect(send().hasAttribute("disabled")).toBe(false)
})

it("applies the ordinary image per-file limit to a captured file", async () => {
  render(
    <Composer
      onCaptureView={async () => sizedImage("large.png", ASSISTANT_MAX_IMAGE_ATTACHMENT_BYTES + 1)}
    />,
  )
  await userEvent.click(capture())
  expect(screen.getByText("large.png exceeds the 5 MB attachment limit.")).toBeTruthy()
  expect(send().hasAttribute("disabled")).toBe(true)
})

it.each(["availability", "images", "callback"])(
  "discards a capture after %s withdrawal, even if restored",
  async (unavailable) => {
    const pending = deferred<File | null>()
    const onCaptureView = vi.fn(() => pending.promise)
    const view = render(<Composer onCaptureView={onCaptureView} />)
    fireEvent.click(capture())
    view.rerender(
      <Composer
        canSend={unavailable !== "availability"}
        attachmentCapabilities={{ text: true, images: unavailable !== "images" }}
        {...(unavailable === "callback" ? {} : { onCaptureView })}
      />,
    )
    view.rerender(<Composer onCaptureView={onCaptureView} />)
    expect(capture().hasAttribute("disabled")).toBe(true)
    expect(capture().getAttribute("aria-busy")).toBe("true")
    await act(async () => {
      pending.resolve(imageFile())
    })
    expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull()
    expect(capture().hasAttribute("disabled")).toBe(false)
  },
)

it("discards a capture on unmount without changing a fresh composer", async () => {
  const pending = deferred<File | null>()
  const view = render(<Composer onCaptureView={() => pending.promise} />)
  fireEvent.click(capture())
  view.unmount()
  render(<Composer />)
  await act(async () => {
    pending.resolve(imageFile())
  })
  expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull()
})
