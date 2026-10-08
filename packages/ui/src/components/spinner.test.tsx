import "../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"

import { Spinner } from "./spinner"

afterEach(cleanup)

describe("Spinner", () => {
  it("uses the localized accessible label supplied by its owner", () => {
    render(<Spinner aria-label="Loading geometry" />)

    expect(screen.getByRole("status", { name: "Loading geometry" })).not.toBeNull()
  })
})
