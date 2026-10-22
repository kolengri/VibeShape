import { expect, it } from "bun:test"
import { JSDOM } from "jsdom"
import { uiIconSource } from "./ui-icon-source"

it("omits unused definitions and empty containers from generated artwork", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="unused"><stop stop-color="#ffffff"/></linearGradient><mask id="unused-mask"><rect width="20" height="20"/></mask></defs><path d="M1 1H10V10Z" fill="#5784b0"/></svg>'
  const dom = new JSDOM(uiIconSource(source), { contentType: "image/svg+xml" })
  try {
    expect(dom.window.document.querySelector("defs")).toBeNull()
    expect(dom.window.document.querySelector("path")?.getAttribute("d")).toBe("M1 1H10V10Z")
    expect(dom.window.document.querySelector("path")?.getAttribute("fill")).toBe("#5784b0")
  } finally {
    dom.window.close()
  }
})

it("retains transitive mask and inherited gradient references while removing unreachable cycles", () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <defs>
      <linearGradient id="base"><stop offset="0" stop-color="#ffffff"/></linearGradient>
      <linearGradient id="paint" xlink:href="#base"/>
      <mask id="cut"><rect id="cut-face" width="20" height="20" fill="url( '#paint' )"/></mask>
      <linearGradient id="unused-a" href="#unused-b"/>
      <linearGradient id="unused-b" href="#unused-a"/>
    </defs>
    <g opacity=".91" mask="url(#cut)"><path d="M1 1H10V10Z" fill="#5784b0"/></g>
  </svg>`
  const dom = new JSDOM(uiIconSource(source), { contentType: "image/svg+xml" })
  try {
    const document = dom.window.document
    expect([...document.querySelectorAll("defs > *")].map((element) => element.id)).toEqual([
      "base",
      "paint",
      "cut",
    ])
    expect(document.querySelector("#cut-face")?.getAttribute("fill")).toBe("url( '#paint' )")
    expect(document.querySelector("svg > g")?.getAttribute("opacity")).toBe(".91")
    expect(document.querySelector("svg > g")?.getAttribute("mask")).toBe("url(#cut)")
    expect(document.querySelector("svg > g > path")?.getAttribute("fill")).toBe("#5784b0")
  } finally {
    dom.window.close()
  }
})
