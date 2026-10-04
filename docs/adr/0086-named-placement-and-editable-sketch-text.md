# ADR-0086: Named Placement and editable sketch text

- Status: Accepted
- Date: 2026-10-04

## Context

Placement and exact editable sketch text already have domain, native and editor implementations. The paired MCP surface must expose those capabilities without introducing a script tool, caller-supplied font provenance or a second mutation path.

## Decision

Expose `create_placement` and `update_placement` with the registered Placement parameters, one exact target body and exactly its producer dependency. Translation and rotation use typed dimensional quantities and existing domain bounds. Updates retain feature identity; preview and ordinary manual review are required.

Expose `create_sketch_text`, `update_sketch_text` and `detach_sketch_text` on both local and paired remote transports. The caller supplies a stable group UUID, supported text intent and a bounded two-dimensional origin. The browser loads the existing bundled font and uses the existing outline library to produce exact line and Bézier entities. Font metadata, outline SDK, digest and entity identities are generated internally. Existing scalar, contour and pole budgets remain binding; a text within the scalar limit can still exceed the outline budget.

An internal host preparation port reads only the requested sketch from the actor-owned draft at its exact revision. It validates committed base revision, active session and expiry and returns a detached validated record. It neither renews expiry nor becomes a public whole-draft query. After asynchronous font preparation and hashing, the ordinary actor-owned `sketch.update` command rechecks authority and revision. Cancellation before application leaves the draft unchanged.

Regeneration preserves group identity and requires an explicit choice about removing constraints attached to replaced entities. Detach removes text intent while preserving exact geometry and constraints. Downstream references to replaced contour entities require explicit repair under the existing editor rules. The tools do not expand CAD auto-apply grants; sketch updates retain the existing policy.

The enlarged static `tools/list` catalog has a separate 2 MiB response cap. Ordinary 512 KiB MCP responses and 192 KiB browser operation budgets retain their limits.

The local static editor serves the bundled TTF with its font MIME type under the existing same-origin, path and content security boundary.

## Consequences

MCP and editor author the same persisted records and use the same kernel, font library, preview, CAS, Undo and save path. No arbitrary font, raw authority, native handle or filesystem path is accepted. Face alignment remains a visible editor calculator rather than an associative Placement contract.

Verification covers strict schemas and transport parity, owned preparation reads, asynchronous cancellation, constraint replacement, native solved profiles and volumes, manual Apply, Undo/Redo and reload through the real MCP client.
