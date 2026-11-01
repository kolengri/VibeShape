# ADR-0144: Portable variable customizers and configurations

- Status: Accepted
- Date: 2026-11-01
- Extends: [ADR-0015](0015-document-variables-and-dimensional-expressions.md)

## Decision

An optional `customizer` object on an authored variable exposes its slider. It contains a group,
finite ordered minimum/maximum, positive step, dimensional kind, and at most 64 named configurations.
Slider ranges and saved values use canonical millimetres, radians, or scalar values; configuration
names contain 1–80 characters. Metadata does not change the expression grammar or feature identity.
Existing documents without customizer metadata keep their existing behavior.

Configuration values are literal numeric snapshots attached to stable variable identities. They do
not introduce hidden expressions or depend on slider inputs. A dimensional change requires removing
or updating the corresponding metadata. Applying a configuration requires every exposed variable to
have a saved value in that configuration, and validates the entire resulting variable table.

The Variables dialog offers the existing table and Customizer views. Slider changes remain local
until Apply. Applying values, configuring sliders, saving or removing a configuration uses the
ordinary revision-checked `variable.replace-table` command and one transaction/Undo step. The normal
table editor preserves metadata. A slider deliberately replaces its input expression with a literal;
expressions in dependent variables and features remain connected. No automatic geometry changes are
made while dragging.

Agents use the existing `replace_variable_table` contract with optional customizer metadata, through
the same owned-draft, preview, review and commit path. This adds no privileged mutation endpoint.

## Tradeoffs

Configurations cover exposed variable values, not feature suppression, materials or assembly poses.
Canonical units keep the initial format independent of UI display preferences. Range expressions
and document-wide configuration objects can be added through a separately versioned extension if
needed. Additive optional metadata avoids changing document schema versions while retaining exact
command/event replay and native-file persistence.
