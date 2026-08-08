# SPK-003: Stable topology references

- Status: **Pass — stable-reference algorithm gate cleared**
- Recorded: 2026-08-08
- Scope: bounded browser OCCT corpus, domain resolver, worker protocol, and immediate face lineage

## Decision

Use a fail-closed `TopoRef` resolver with this precedence:

1. authoritative semantic output role;
2. authoritative immediate OCCT lineage token;
3. conservative geometry and adjacency signature only when no authoritative anchor exists.

The resolver returns `resolved`, `ambiguous`, or `missing`. A missing semantic role or lineage token does not fall through to a visually similar face. Candidate IDs and OCCT hashes are evaluation-local implementation details and are never persisted.

SPK-003 passes its Phase 0 stop/go criterion: the required corpus contains zero false confident matches and produces an explainable ambiguity for the symmetric case. This selects the reference algorithm and kernel seam; it does not promote the spike worker into the production feature evaluator.

## Implemented contract

`@vibeshape/domain/topology` owns the runtime-validated document-side types:

- `TopoRef` schema version `0`;
- topology kinds `vertex`, `edge`, and `face`;
- optional semantic role and immediate lineage token;
- finite geometry signature with measure, centroid, bounds, optional normalized direction, boundary count, and adjacent geometry classes;
- optional near-point and expected-direction intent;
- resolution policy version `1`;
- explicit resolution result union.

Protocol v5 carries worker topology candidates with:

- evaluation-local candidate ID;
- topology kind;
- optional semantic role;
- zero or more durable lineage tokens;
- geometry and adjacency signature.

The protocol does not carry native handles, Replicad objects, OCCT hashes, or transient face and edge indices.

## OCCT lineage seam

The geometry adapter uses OCCT `Modified`, `Generated`, and `IsDeleted` relations while each builder is alive. Source faces receive durable tokens derived from reviewed feature outputs, such as `output:base-extrude.cap.end` and `output:pattern.hole.negative.wall`.

Boolean operations propagate tokens to modified and generated descendants. Unchanged, non-deleted faces retain their existing token. Fillet operations propagate face tokens through modified or unchanged faces. The spike composes these maps across sequential holes and the final fillet.

OCCT `HashCode` values join source faces, relation results, and final Replicad candidates only inside one worker evaluation. They are discarded before the protocol response is created. The durable token contains semantic feature-output identity, never the hash.

The implemented history seam is face-only. Edge and vertex schemas exist in the domain contract, but durable edge and vertex lineage remain production follow-up work.

## Signature policy

Policy version `1` uses these normalized weights:

| Component | Weight |
|---|---:|
| Measure | 0.20 |
| Centroid or near-point intent | 0.25 |
| Direction or expected-direction intent | 0.20 |
| Bounds | 0.15 |
| Boundary count | 0.10 |
| Adjacent geometry classes | 0.10 |

The maximum accepted score is `0.22`; lower is better. The minimum confidence margin is `0.035`. Geometry class and topology kind must match before scoring. Direction comparison supports oriented normals and unoriented axes. Adjacency is compared as a multiset.

Two candidates inside the ambiguity margin return `ambiguous`. A candidate above the maximum score returns `missing`. Changing thresholds or weights requires corpus evidence.

## Corpus

The deterministic fixture starts with a `60 × 40 × 20 mm` box, two non-overlapping through-holes, and a `1.5 mm` outer top-edge fillet. Reviewed roles cover both caps, four box sides, two hole walls, and four fillet surfaces.

The local browser matrix rebuilds these scenarios sequentially in one initialized worker:

1. baseline;
2. increased length;
3. increased width;
4. increased height;
5. increased hole radius;
6. hole pattern crossing the origin;
7. increased fillet radius;
8. pattern count increased to three;
9. pattern count reduced to the seed instance;
10. hole feature suppressed;
11. fillet feature suppressed;
12. upstream features restored.

The matrix also creates an unanchored signature reference for a real cap and a deliberately symmetric signature between the two real hole walls.

## Evidence

Run the evidence locally:

```bash
bun run topology:evidence
```

The command uses `playwright.topology.config.ts`, one local Chromium worker, and the actual OCCT WASM adapter. Both the runner and Playwright configuration reject a truthy `CI` environment. No GitHub Actions workflow invokes the command. Reports remain ignored under `.artifacts/topology-spike` and Playwright diagnostics under `.artifacts/playwright`.

The recorded local run used Chromium `151.0.7922.34` and produced:

| Result | Count |
|---|---:|
| Scenarios | 12 |
| Baseline semantic references | 12 |
| Semantic resolutions | 136 |
| Expected semantic missing results | 8 |
| History references per scenario | 2 |
| History resolutions | 22 |
| Expected history missing results | 2 |
| Signature fallback resolutions | 1 |
| Deliberate symmetric ambiguities | 1 |
| False confident matches | **0** |

The symmetric pair received identical best scores of approximately `0.21350`, inside the accepted threshold and with a zero confidence margin, so the resolver returned `ambiguous`. The real cap signature resolved with score `0` and a confidence margin of approximately `0.41795`.

Suppressed feature outputs returned `semantic-role-missing` or `lineage-missing`. Restoring upstream features resolved every baseline semantic reference again.

## Defect found by the corpus

The first local run exposed duplicate semantic roles when a three-hole pattern caused the existing fillet adapter to include circular hole rims. The adapter selected every edge lying in the target Z plane, even though the intended operation was the four outer linear edges.

The fix restricts the fillet set to linear target-plane edges using transient evaluation-local shape keys. The corpus remains strict: it still fails if any scenario emits duplicate semantic roles. A separate invalid overlapping-hole fixture was removed by increasing pattern spacing so the pattern-count case tests topology growth rather than a merged cut profile.

## Verification layers

- Zod rejects non-finite, non-normalized, kind-mismatched, or malformed references and candidates.
- Domain unit tests cover semantic precedence, missing authoritative anchors, exact and split history, conservative thresholds, symmetry, duplicate candidate IDs, and invalid signatures.
- Geometry unit tests cover candidate adjacency, wrapper cleanup, transient-key exclusion, and history relation propagation.
- Protocol tests cover v5 request and response validation and bounded topology-spike parameters.
- Runtime tests cover dispatch and structured-clone response behavior.
- Ordinary cross-browser E2E verifies topology candidates on the SPK-001 fixture.
- The dedicated local Chromium corpus verifies the full mutation matrix and report.

## Known limits and production follow-up

- Integrate `TopoRef` into committed feature records and the production DAG evaluator.
- Add edge and vertex lineage where features require it.
- Persist user repair intent and verify repair, save, reopen, and rebuild.
- Expand from the bounded box-and-hole fixture to bracket, enclosure, flange, imported STEP, split-face, and property-based corpora.
- Add downstream blocked-feature diagnostics and repair UX.
- Calibrate tolerances on additional operating systems, browsers, and the selected production OCCT artifact.
- Decide whether the production geometry facade remains Replicad-backed or uses the direct controlled binding.

These items affect product integration and coverage. They do not invalidate the Phase 0 decision that semantic outputs, composed OCCT face lineage, and conservative signatures can prevent silent remapping in the required bounded corpus.
