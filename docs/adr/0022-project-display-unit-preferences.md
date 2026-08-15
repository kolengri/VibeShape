# ADR-0022: Revisioned project display-unit preferences

- Status: Accepted
- Date: 2026-08-15

## Context

VibeShape already accepts explicit length literals in `um`, `mm`, `cm`, `m`, `in`, and `ft`, and angle literals in `deg` and `rad`. Domain quantities normalize length to millimeters and angles to radians so geometry, hashes, tolerances, persistence, and exchange formats do not depend on presentation. The product UI nevertheless displayed millimeters and degrees unconditionally and interpreted bare numeric feature and sketch-dimension input as millimeters.

A project-level preference must change authored defaults and displayed results without changing the physical model. It must also survive local persistence, reload, `.vshape` round-trip, replay, extension commands, and future MCP automation. Treating a preference as unrevisioned browser state would let two command clients observe different document semantics and would omit an intentional project setting from portable backups.

## Decision

Every `DocumentSnapshot` stores a strict `displayUnits` record with one supported length unit and one supported angle unit. New documents and older schema-v0 snapshots derive `{ length: "mm", angle: "deg" }`. The ordinary revisioned command path exposes `org.vibeshape.document.set-display-units` schema version 1. Its event records both the previous and replacement preferences for deterministic replay, tamper detection, and future inverse generation. An unchanged preference is a no-op.

Display preferences never alter canonical quantity storage:

- length remains millimeters and angle remains radians;
- geometry identities, tolerances, solver input, print checks, and export policies use canonical values;
- changing only `displayUnits` does not rewrite existing feature, sketch, constraint, or variable expressions;
- `.vshape` keeps the canonical `units: "millimeter"` manifest declaration while its authoritative snapshot and journal preserve the display preference.

Length and angle fields apply the following authoring boundary:

- a bare finite numeric literal is normalized to an explicit literal in the current project unit before command construction;
- an explicit unit literal, expression, or `#variable` reference remains unchanged;
- newly created fields derive their default literal from the canonical default converted into the current project unit;
- editing an existing value restores its exact authored expression;
- generic variable expressions continue to require an explicit unit because their dimension is not known before evaluation.

Rendered length, area, and angle results convert from canonical values through shared display helpers. Area conversion squares the selected length scale. Serialized decimal syntax remains locale-independent and uses `.`.

The application bar owns an icon-only, tooltip-labeled Units dialog. It composes state-agnostic select fields through TanStack Form, validates the final payload with Zod, dispatches one single-flight command, rejects stale revisions through the normal controller, disables semantic changes in read-only mode, and exposes adjacent failure diagnostics. The status bar and modeling view make the active preference visible.

## Consequences

- A user can author and inspect one project consistently in metric or imperial length units and degrees or radians.
- Switching units changes presentation and new bare-input interpretation, never physical dimensions.
- Every first-party UI, extension, and future MCP client observes and changes the same revisioned preference through the ordinary command registry.
- Old schema-v0 documents remain readable with deterministic defaults, while exported schema-v0 projects round-trip an explicitly changed preference.
- New dimensional UI must use the shared project-unit context, normalize bare typed values at its command boundary, preserve existing authored expressions, and test at least one non-default unit.
- Localized decimal input, field-specific override units, tolerance-aware stepping, and compound dimensions remain separate contracts.

## Rejected alternatives

- **Store the preference only in browser settings:** loses project portability and lets command clients disagree.
- **Rewrite every expression when units change:** creates noisy semantic edits, damages authored intent, and risks rounding drift.
- **Change the document's canonical unit:** contaminates geometry tolerances, hashes, solver contracts, and file exchange with presentation state.
- **Treat every bare number as millimeters:** makes an imperial project appear supported while silently authoring incorrect dimensions.
