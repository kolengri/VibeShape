import { JSDOM } from "jsdom"

function references(elements: Iterable<Element>) {
  const ids = new Set<string>()
  for (const element of elements) {
    for (const attribute of element.attributes) {
      for (const match of attribute.value.matchAll(/url\(\s*['"]?#([^'"\s)]+)['"]?\s*\)/g)) {
        if (match[1]) ids.add(match[1])
      }
      if (attribute.localName === "href" && attribute.value.startsWith("#"))
        ids.add(attribute.value.slice(1))
    }
  }
  return ids
}

function definitionOwners(definitions: Element[]) {
  const owners = new Map<string, Element>()
  for (const definition of definitions) {
    for (const element of [definition, ...definition.querySelectorAll("[id]")]) {
      const id = element.getAttribute("id")
      if (id) owners.set(id, definition)
    }
  }
  return owners
}

/** Retain only definitions reachable from visible artwork, including dependencies inside masks. */
export function uiIconSource(source: string): string {
  const dom = new JSDOM(source, { contentType: "image/svg+xml" })
  try {
    const svg = dom.window.document.documentElement
    const containers = [...svg.querySelectorAll("defs")].filter(
      (container) => !container.parentElement?.closest("defs"),
    )
    const definitions = containers.flatMap((container) => [...container.children])
    const owners = definitionOwners(definitions)
    const pending = [
      ...references(
        [svg, ...svg.querySelectorAll("*")].filter((element) => !element.closest("defs")),
      ),
    ]
    const retained = new Set<Element>()
    while (pending.length) {
      const id = pending.pop()
      const definition = id === undefined ? undefined : owners.get(id)
      if (!definition || retained.has(definition)) continue
      retained.add(definition)
      pending.push(...references([definition, ...definition.querySelectorAll("*")]))
    }
    for (const definition of definitions) {
      if (!retained.has(definition)) definition.remove()
    }
    for (const container of containers) {
      if (!container.children.length) container.remove()
    }
    return svg.outerHTML
  } finally {
    dom.window.close()
  }
}
