import { createLatestFramePublisher } from "./latest-frame-publisher"

/** Ordinary hover is replaceable; tool picking and activation remain synchronous. */
export class PointerHoverPicking {
  readonly #pick: (event: PointerEvent) => void
  readonly #frames

  constructor(
    pick: (event: PointerEvent) => void,
    schedule?: (callback: FrameRequestCallback) => number,
    cancelScheduled?: (handle: number) => void,
  ) {
    this.#pick = pick
    this.#frames = createLatestFramePublisher(pick, schedule, cancelScheduled)
  }

  update(event: PointerEvent, ordinary: boolean) {
    if (ordinary) this.#frames.push(event)
    else {
      this.cancel()
      this.#pick(event)
    }
  }

  cancel() {
    this.#frames.cancel()
  }
}
