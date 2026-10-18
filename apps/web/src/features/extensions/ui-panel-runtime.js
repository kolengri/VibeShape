// Host-owned runtime. Package values arrive only as data through the private port.
function validInput(field, value) {
  return value !== undefined && Number.isFinite(value) && value >= field.min && value <= field.max
}
function calculateUiPluginOutputs(panel, values) {
  for (const field of panel.inputs) {
    const value = values.get(field.id)
    if (!validInput(field, value)) throw new Error("invalid-input")
  }
  return panel.outputs.map((output) => {
    let value = output.constant
    for (const term of output.terms) value += (values.get(term.inputId) ?? NaN) * term.coefficient
    if (!Number.isFinite(value)) throw new Error("invalid-result")
    return { id: output.id, value }
  })
}
function acceptsInitialization(event, nonce, connected) {
  return [
    !connected,
    event.source === parent,
    event.data?.type === "vibeshape.ui-plugin.initialize",
    event.data?.schemaVersion === 1,
    event.data?.sessionNonce === nonce,
    event.ports.length === 1,
  ].every(Boolean)
}
function runUiPanel(calculate) {
  const nonce = document.currentScript?.getAttribute("data-session")
  let connected = false
  addEventListener("message", (event) => {
    const initial = event.data
    if (!acceptsInitialization(event, nonce, connected)) return
    connected = true
    const port = event.ports[0]
    if (!port) return
    let sequence = 0
    const send = (type) =>
      port.postMessage({
        schemaVersion: 1,
        type,
        extensionId: initial.extensionId,
        sessionNonce: nonce,
        panelId: initial.panel.id,
        capability: "ui.panel",
        sequence: sequence++,
      })
    const root = document.body
    const title = document.createElement("h1")
    title.textContent = initial.panel.title
    const description = document.createElement("p")
    description.textContent = initial.panel.description
    const controls = document.createElement("div")
    controls.setAttribute("role", "group")
    controls.setAttribute("aria-label", initial.panel.title)
    const fields = new Map()
    for (const field of initial.panel.inputs) {
      const label = document.createElement("label")
      const caption = document.createElement("span")
      caption.textContent = field.label
      const input = document.createElement("input")
      input.id = field.id
      input.setAttribute("aria-label", field.label)
      input.type = "number"
      input.min = String(field.min)
      input.max = String(field.max)
      input.step = String(field.step)
      input.value = String(field.default)
      input.required = true
      const unit = document.createElement("small")
      unit.textContent = field.unit
      label.append(caption, input, unit)
      controls.append(label)
      fields.set(field.id, input)
    }
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = initial.copy.compute
    const error = document.createElement("p")
    error.setAttribute("role", "alert")
    const results = document.createElement("section")
    results.setAttribute("aria-label", initial.copy.results)
    results.setAttribute("aria-live", "polite")
    const update = () => {
      error.textContent = ""
      try {
        const values = new Map(
          Array.from(fields, ([id, input]) => [id, input.value === "" ? NaN : Number(input.value)]),
        )
        const computed = calculate(initial.panel, values)
        results.replaceChildren()
        for (const result of computed) {
          const definition = initial.panel.outputs.find(({ id }) => id === result.id)
          if (!definition) continue
          const label = document.createElement("label")
          label.textContent = definition.label
          const output = document.createElement("output")
          output.textContent = String(Number(result.value.toPrecision(12)))
          const unit = document.createElement("small")
          unit.textContent = definition.unit
          label.append(output, unit)
          results.append(label)
        }
        send("calculated")
      } catch {
        results.replaceChildren()
        error.textContent = initial.copy.invalidInputs
      }
    }
    button.addEventListener("click", update)
    controls.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return
      event.preventDefault()
      update()
    })
    controls.append(button)
    root.replaceChildren(title, description, controls, error, results)
    send("ready")
    update()
  })
}
runUiPanel(calculateUiPluginOutputs)
