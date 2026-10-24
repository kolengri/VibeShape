type NavigationOwner = "controls" | "orientation"

/** Keeps background work paused through held gestures and short camera-change bursts. */
export class NavigationActivity {
  readonly #onChange: ((active: boolean) => void) | undefined
  readonly #owners = new Set<NavigationOwner>()
  #timer: ReturnType<typeof setTimeout> | undefined
  #active = false
  #disposed = false

  constructor(onChange: ((active: boolean) => void) | undefined) {
    this.#onChange = onChange
  }

  begin(owner: NavigationOwner) {
    if (this.#disposed || !this.#onChange) return
    this.#owners.add(owner)
    this.#activate()
  }

  end(owner: NavigationOwner) {
    this.#owners.delete(owner)
    this.#scheduleIdle()
  }

  pulse() {
    if (this.#disposed || !this.#onChange) return
    this.#activate()
    this.#scheduleIdle()
  }

  #activate() {
    clearTimeout(this.#timer)
    if (this.#active) return
    this.#active = true
    this.#onChange?.(true)
  }

  #scheduleIdle() {
    if (this.#disposed || !this.#active || this.#owners.size > 0) return
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.#active = false
      this.#onChange?.(false)
    }, 200)
  }

  dispose() {
    this.#disposed = true
    clearTimeout(this.#timer)
    this.#owners.clear()
  }
}
