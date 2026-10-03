# ADR-0056: Bounded authored metadata automation

- Status: Accepted
- Date: 2026-10-03
- Extends: [ADR-0013](0013-microkernel-modules-and-mcp-automation.md), [ADR-0054](0054-authored-parts-and-organizational-history-folders.md)

## Decision

`model_parts` and `model_folders` expose bounded pages from the paired V2 document at an exact
revision. `model_history` pages canonical interleaved references and labels (up to 100,256 items),
so folder ranges never infer History order from legacy storage arrays. Parts expose authored identity, name, visibility, origin, current semantic body reference
and consumption. Folders expose identity, name, contiguous range endpoints and member count.
Metadata and names remain untrusted data. These reads never expose another project or kernel handles.

`change_metadata` accepts one domain-owned discriminated metadata change, its committed base revision
and its exact command ID. It is an additional first-party typed host adapter over V2 authority;
it does not synthesize legacy features or variables and does not widen the unchanged V0 CAD draft
schema. The host validates the separately authenticated paired MCP actor, prepares one disposable
V2 result through `applyDocumentV2Command`, projects compatibility geometry through V1/V0, and evaluates
that projection through the existing disposable exact worker and registered measurement query.

The common browser review always requires manual Apply/Discard for metadata. It displays the exact
change, target name and folder range; folder removal explicitly preserves all member features.
Approval rechecks pairing, cancellation, five-minute expiry, authored base and duplicate command
identity before ordinary `session.commitAuthored`. The session revalidates the retained command and
expected result, checks revision and writer lease, persists one event and creates one Undo entry.
Cancellation after persistence begins cannot be represented as cancellation before a save.

Inputs are limited to 192 KiB and outputs to 128 KiB. Pages contain at most 200 entries. One proposal
runs per metadata session; at most 4,096 command IDs are retained, after which reconnect is required.
Duplicate preflight checks both existing journal indexes; the unique database index remains the
transactional final defense. Project switch, revision change, disconnect and request cancellation
invalidate disposable work. No arbitrary code, raw database, OS, network or secret access is added.

## Validation

Focused host tests cover actor binding, preserved intent, stale/duplicate/cancelled/expired proposals,
manual rejection, invalid geometry and persistence settlement. Real production MCP/browser validation
passed all three browser engines for bounded list, rename/visibility, folder create/edit/remove,
manual Apply/Discard, duplicate/stale rejection, Undo, native backup/reload and disconnect, while
retaining exact geometry. The same immutable runtime also passed the existing CAD auto-apply and
human-edit-to-AI-edit checks across all three engines. Receipts and retained traces are recorded in
`.artifacts/metadata`, bound to `runtime-manifest.json`; the previously interrupted browser receipts
were rerun without a production code change.
