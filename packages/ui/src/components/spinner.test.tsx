// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Spinner } from "./spinner"

afterEach(cleanup)

describe("Spinner", () => {
  it("uses the localized accessible label supplied by its owner", () => {
    render(<Spinner aria-label="Loading geometry" />)

    expect(screen.getByRole("status", { name: "Loading geometry" })).not.toBeNull()
  })
})
