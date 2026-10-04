# ADR-0089: Owned assembly and library MCP drafts

- Status: Accepted
- Date: 2026-10-04
- Related: ADR-0043, ADR-0052, ADR-0058, ADR-0069, ADR-0073, ADR-0080

## Context

Assembly authority is authored V4 document state with immutable selected source pins. General mates
need the same exact worker preflight as the editor. The existing CAD automation host owns ordinary
feature/sketch commands, so exposing assembly mutations through that host would conflate its command
revision with a staged constraint graph. Library publication also owns frozen source closures that
must remain outside caller-controlled MCP payloads.

## Decision

Expose additive named assembly and local-library tools through a shared automation API registry and
the paired local and remote transports. Keep TypeScript/Bun and existing domain, worker, persistence
and SolveSpace/OCCT ports; no new computational core or runtime dependency is introduced.

An adapter-neutral assembly coordinator owns at most eight drafts per paired actor. Each retains a
parsed authored snapshot, original base revision, private draft version, captured named mutations and
owned source bytes. Draft versions count successful staged mutations; they are not persisted document
revisions. Five-minute expiry, actor ownership, session generation and base revision are checked at
asynchronous boundaries before returning/caching evidence or entering publication. Payloads cannot
provide document authority, pins, raw bytes, arbitrary commands or an approval capability.

Named graph edits may temporarily violate assembly invariants while related records are staged.
Exact preview applies the complete graph to a disposable promoted V4 authority and invokes the
controller's ordinary worker solver/materializer. Existing v1 forests remain strict; general mates
require an explicit v2 upgrade. Unsolvable or unresolved graphs cannot be committed.

Every assembly commit requires browser-owned manual review, even with CAD auto-apply enabled. The
coordinator captures the exact actor/base/draft-version/payload before showing the dialog, rejects
concurrent edits, rechecks authority and invokes exact preview again after approval. A private
controller coordinator then enters the ordinary authored revision CAS and Undo path. Public document
commit retains its existing busy guard. No caller token or approved boolean bypasses review.

Library reads and source capture use scoped repository/controller ports. Publication captures and
verifies the current source closure, reviews metadata and publishes immutable content with library
metadata CAS. Insert/relink load owned immutable versions; clients choose copy/reference semantics,
stable IDs and numeric pose but cannot provide the closure. Metadata edits do not change versions. A trusted synchronous guard rechecks captured actor/session/base/expiry inside library write transactions after asynchronous hashing and reads; throwing aborts all staged blob/version/metadata writes. The guard is a private port callback, not an MCP payload. Ordinary UI callers may omit it.
No external upload or paid service is involved.

Read views omit meshes, native handles and closure bytes. Frozen topology discovery is explicitly
paged for one selected occurrence/source. Operation responses retain a 128 KiB serialized budget. The
server-generated static `tools/list` catalog has a separate 2 MiB cap; this does not expand browser
operation or result limits. Exact
interference requires explicit pairs. Typed mate failures preserve joint IDs; local DOF and
redundancy are evidence at the solved branch, not proof of global uniqueness.

## Consequences

Assembly and library authoring share vocabulary and authority on both MCP transports without a second
CAD engine. The separate private version distinguishes graph staging from persisted revisions and
allows related mate edits to be reviewed atomically. Ordinary geometry/asset validation, cancellation,
revision conflicts, immutable versions and Undo remain controlling. A proposal preview remains unsaved;
publication receipts are distinct from browser appearance and manufacturing evidence.

Tests cover actor/version/TTL isolation, late async results, unsolvable preflights before and after
approval, rejected caller authority, library CAS and receipt identity. Real paired MCP browser tests
exercise discovery, authored source capture, native mate solving, exact interference, topology binding,
manual Apply, library insertion and persisted reload.
