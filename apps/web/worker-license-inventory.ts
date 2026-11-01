/** One inventory shared by all worker bundles in a Vite build. */
export class WorkerLicenseInventory {
  readonly #notices = new Map<string, string>()

  clear() {
    this.#notices.clear()
  }

  add(name: string | null, version: string | null, notice: string) {
    if (!name || !version) throw new Error("Worker dependency license metadata is incomplete.")
    if (!notice.trim()) throw new Error(`Empty worker dependency notice: ${name}@${version}`)
    this.#notices.set(`${name}@${version}`, notice)
  }

  text() {
    if (!this.#notices.size) throw new Error("The worker dependency license inventory is empty.")
    return [...this.#notices]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([, notice]) => notice)
      .join("\n\n---\n\n")
  }
}
