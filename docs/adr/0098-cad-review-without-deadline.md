# ADR-0098: CAD review without a deadline

- Status: Accepted
- Date: 2026-10-05
- Supersedes: the CAD review expiry rule in [ADR-0042](0042-exact-automation-draft-application-path.md)

## Decision

A CAD draft that has passed exact geometry validation and entered host-owned review does not expire
while the person considers Apply or Discard. The browser does not schedule an expiry timer for that
review. The host retains the original owner-bound draft through its review and post-approval base
validation, then releases that retention on every approved, rejected, cancelled or failed outcome.

The original idle `expiresAt` remains part of the existing draft contract. It applies before review
and again after an unsuccessful review; no schema, persistence or document format changes are made.
Idle construction, exact geometry work, uploads and separate assembly, metadata, history and texture proposal
lifetimes are unchanged.

Approval still rechecks the active document, committed base, ownership and ordinary write authority.
The serial host queue prevents draft mutations during review. Cancellation, disconnection, project
replacement and revision changes still release or invalidate review. A client request timeout can
still cancel its operation; removing a human-review deadline does not promise a save after a lost
connection, and clients must inspect an unconfirmed outcome before requesting fresh review.

## Consequences and evidence

The person can inspect a CAD proposal without losing it to the five-minute idle timer. One pending
review retains bounded draft intent until decision or session cancellation and occupies the existing
serialized operation slot. This change does not broaden automatic approval or retain approval for
later writes.

Host and browser-state regression tests advance time by a day and then approve the same proposal.
Existing stale-revision, cancellation, single-decision, ownership and persistence tests remain
required. Other proposal types continue to enforce their existing deadlines.
