# ADR-0076: Closed Shells and Durable Opening Identity

- Status: Accepted
- Date: 2026-10-04
- Supersedes the version-1-only authoring boundary in [ADR-0060](0060-persisted-body-bound-shell-openings.md).

## Decision

Shell schema version 2 retains one exact named-body target, positive expression-aware thickness,
explicit inward/outward direction, source content hash, and body-bound face references. It allows
zero to sixty-four openings. Zero openings explicitly authors a closed cavity; the UI keeps this
choice separate from an unresolved or empty open-face selection.

Version 1 remains readable with its original minimum of one opening and strict source-content
binding. New UI and named MCP create/update commands author version 2. An explicit update upgrades
an old feature without replacing its identity, part ownership, or history.

On an unchanged source, opening resolution still requires exact signature agreement. After source
content changes, version 2 permits only unique durable semantic or native-history identities in the
same exact output body. Every stored identity used for resolution must identify the same face.
Missing, split, conflicting, duplicate, and ambiguous identities fail closed. Geometric proximity,
face ordinals, and congruent signatures never substitute for identity on a changed source. Modifier
Extrusion roles inferred from cutter geometry are not durable identities; these openings require
native history or explicit repair.

The open-shell builder retains the owned source copy and native thick-solid path. Closed shells
offset a copy into a solid and subtract the nested inner solid: source minus inward offset, or
outward offset minus source. Acceptance requires valid single solids, the expected positive wall
volume, unchanged source geometry, and an inner closed shell. A collapsed or non-nested offset
cannot become a successful full solid. Native intermediates are released on success and failure.

The Shell task supports viewport face toggling and descriptive checkbox selection against current
body evidence. Multiple selected faces remain highlighted. A translucent selectable source stays
available during exact preview, including when editing a consumed historical source. Candidate and
mesh face IDs remain transient; only body-bound references are persisted. Closed-cavity selection
releases the opening picker. Preview, Apply/Cancel, asynchronous save locks, undo/redo, native
reopening, and export retain their existing owners.

## Verification

Cover closed inward/outward metrics and invalid thickness, source ownership and native cleanup,
version-1 compatibility, semantic and history preservation, missing/ambiguous identity, authored
part continuation and replay, current-evidence viewport selection, and native archive reopening.
Use actual OCCT geometry and browser workflows in addition to schema and component tests.
