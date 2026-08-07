# Data model and native file format

## Core entities

```mermaid
erDiagram
    DOCUMENT ||--o{ FEATURE : contains
    DOCUMENT ||--o{ BODY : derives
    DOCUMENT ||--o{ VARIABLE : defines
    DOCUMENT ||--o{ SNAPSHOT : records
    DOCUMENT ||--o{ IMPORT_SOURCE : embeds_or_links
    FEATURE ||--o| SKETCH : may_define
    FEATURE }o--o{ FEATURE : depends_on
    FEATURE ||--o{ TOPO_REF : references
    SKETCH ||--o{ SKETCH_ENTITY : contains
    SKETCH ||--o{ CONSTRAINT : constrains
    BODY ||--o{ MESH_CACHE : derives
    DOCUMENT }o--o| PRINTER_PROFILE : uses
```

## Identifiers

- Use lowercase UUIDv7 identifiers for current document, command, draft, and automation-session contracts. A future compatible sortable identifier requires an explicit schema migration.
- IDs never encode array position or user-visible names.
- Renaming does not change an ID.
- Copying creates new IDs and explicit `derivedFrom` metadata.
- Sketch sub-elements have their own IDs.
- Kernel handles and array indices are never serialized as identity.

## Document schema

Conceptually:

```text
Document
  id, schemaVersion, createdAt, updatedAt
  name, description, units, coordinateSystem
  extensionLocks[]
  variables[]
  features[]
  bodiesMetadata[]
  imports[]
  printerProfileRef?
  applicationMetadata
```

`features[]` uses a stable presentation order, while every feature retains explicit inputs. Opening a file constructs the DAG and rejects missing IDs and cycles.

A built-in feature stores a stable first-party module ID, module version, contributed feature-type ID, and feature schema version. A custom feature additionally stores:

- its contributed feature-type identifier;
- parameter-schema version;
- a reference to one exact `ExtensionLockEntry` containing extension ID, version, API version, and integrity hash;
- its original validated parameter payload;
- the last evaluation status and stable diagnostic codes.

The document preserves unknown custom-feature payloads without interpreting or rewriting them. Exact extension bytes are installed and stored separately; they are never authoritative entries inside the project archive.

## Command and event model

Alpha uses a hybrid model:

- A current snapshot opens the project quickly.
- An append-only command/event journal supports autosave, undo, and crash recovery.
- Periodic snapshots bound replay time.
- Geometry caches never enter the semantic event stream.

A command contains:

- `commandId`, `documentId`, and `baseRevision`;
- `kind`, `schemaVersion`, and typed payload;
- structured actor provenance such as `user`, `extension`, `mcp`, or `system`, with bounded source and session identifiers where applicable but no model prompt;
- `issuedAt` for UX and audit only, never for the geometry result;
- inverse data or sufficient information for deterministic reduction;
- no derived geometry or transport-specific prompt data.

An accepted event records the resulting revision. The persistence transaction will add the authoritative content hash when the journal and snapshot store are implemented.

The domain reducer MUST be deterministic: one snapshot plus the same commands produces the same domain state. Geometry may vary slightly between OCCT builds, so engine build metadata is recorded separately.

### Implemented foundation slice

`@vibeshape/domain` currently implements a deliberately narrow versioned slice:

- strict runtime schemas for document, command, draft, actor, event, module, and command-descriptor boundaries;
- `org.vibeshape.document.create` and `org.vibeshape.document.rename` command schema version 1;
- deterministic created and renamed events, canonical snapshots, and event replay;
- safe non-negative revision preconditions, explicit stale-revision diagnostics, and revision-exhaustion rejection;
- actor-bound disposable drafts whose commands share one transaction ID and commit only against the original base revision;
- a first-party `org.vibeshape.core.document` module descriptor and deterministic registry validation for ownership, uniqueness, dependencies, and cycles;
- an executable trusted-command dispatcher that requires exactly one handler per descriptor and validates command route, owner, and schema-version parity before execution;
- automation exposure and confirmation metadata without importing MCP or transport types.

This slice does not yet implement content hashing, persistence, autosave, undo/redo, feature DAGs, units, geometry preview, draft expiry, extension execution, or the `.vshape` codec. Its schemas are internal experimental contracts until their owning ADR and Phase 1 acceptance gates stabilize them.

## Units and expressions

A numeric parameter stores:

- canonical dimension vector such as length, angle, or dimensionless, with millimeters as the CAD length basis;
- normalized numeric value;
- optional original expression string;
- separate display-unit preference.

JSON never depends on locale. The native decimal separator is always `.`. The UI may accept localized input but normalizes it before commit.

## `.vshape`

The extension identifies a ZIP container with MIME type `application/vnd.vibeshape.project+zip`.

```text
project.vshape
  manifest.json
  document.json
  journal/events.jsonl
  snapshots/<revision>.json.zst       # optional
  imports/<source-id>/<original-name> # optional embedded source
  cache/brep/<hash>.brep.gz           # optional, untrusted
  cache/mesh/<hash>.bin               # optional, untrusted
  previews/thumbnail.png              # optional
  reports/last-print-check.json       # optional, derived
  extensions/lock.json                # exact requirements, no executable code
  licenses/NOTICE.txt                 # optional per-project attachments
```

Alpha may use gzip or deflate instead of zstd to reduce dependencies. The selected compression algorithm is recorded in the manifest.

### `manifest.json`

Required fields:

- `format: "vshape"`;
- `formatVersion`;
- `minimumReaderVersion`;
- `documentId`;
- `createdBy: { application, version, build }`;
- `engine: { adapter, occtVersion, buildHash, tolerancePolicyVersion }`;
- `rootDocument: "document.json"`;
- semantic-entry `checksums`;
- `requiredCapabilities` and a checksum for `extensions/lock.json` when present;
- `createdAt` and `exportedAt`;
- `units` and `coordinateSystem`.

### Authoritative data

`document.json` plus journals and snapshots are authoritative. `cache/` and `reports/` MAY be deleted without project loss. Readers must open a project without cache and must not trust B-Rep, mesh, topology mapping, version, or checksum blindly.

### Extension requirements

`extensions/lock.json` deduplicates exact requirements used by custom features:

```text
ExtensionLockEntry
  id
  version
  apiVersion
  integrity: { algorithm: "sha256", digest }
  sourceHint?
  signatureIdentity?
```

The lock file is authoritative metadata, but it contains no JavaScript, WebAssembly, HTML, or remote loader URL. `sourceHint` is informational and is never fetched while opening or rebuilding a project.

Opening a project never installs, updates, enables, or grants permissions to an extension. If an exact artifact is unavailable, disabled, incompatible, or fails its budget, the reader:

1. preserves its lock and feature payload unchanged;
2. marks the owning feature with a typed extension diagnostic;
3. blocks or stales downstream features through ordinary DAG rules;
4. allows safe metadata inspection and export of the original archive;
5. may display the last valid cache only as stale, non-authoritative geometry;
6. never substitutes another version or exports stale geometry as newly validated output.

The detailed package, upgrade, and restricted-mode behavior is defined in [Extension architecture](extensions.md).

### Versioning

- Major format changes update `formatVersion` and may require explicit migration.
- Old readers ignore additive fields only when the extension is optional.
- Unknown required capabilities block editing but SHOULD allow safe metadata preview and export of the original archive.
- Unknown extension lock fields are preserved; an unsupported required extension API blocks evaluation rather than migration by guesswork.
- Migrations are pure, sequential, and fixture-tested.
- Readers never overwrite the source during migration until a complete save succeeds.
- Export to an older version is allowed only when conversion is proven lossless.

## External and embedded imports

By default, imported STEP and STL sources are **embedded** so the project remains portable. Advanced mode may retain an external handle or path hint, but:

- browser permissions may not survive sessions;
- a path is not identity;
- the source has a checksum and last import report;
- external changes never apply automatically;
- privacy-sensitive absolute paths are excluded from export unless explicitly requested.

## Binary mesh cache

Use a simple project-owned little-endian envelope:

- magic and version;
- body ID, source feature hash, and tolerance policy;
- counts and byte lengths;
- typed-array sections;
- checksum;
- optional face mapping.

Validate all counts before allocation and protect size arithmetic from overflow.

## Reader limits

Initial safe defaults:

| Limit | Default |
|---|---:|
| Compressed ZIP input | 512 MiB |
| Total uncompressed ZIP size | 2 GiB or available quota, whichever is lower |
| Compression ratio | Warn or block at 100:1 according to policy |
| Entry count | 10,000 |
| JSON depth | 100 |
| Feature count | 100,000 hard limit with a much lower UX warning |
| Single typed-array allocation | 512 MiB |
| Filename/path | 1,024 UTF-8 bytes |

Fuzzing and performance tests refine these numbers. Reject entries containing `..`, absolute paths, symlinks, or duplicate normalized paths.

## Compatibility promise

The format remains experimental before v1. Starting with v1:

- the current reader opens every older stable `.vshape` through migrations;
- the last two stable writer versions remain in the CI fixture corpus;
- semantic data is never removed without an explicit migration report;
- the format is documented well enough for an independent implementation to extract documents, events, and imports without a CAD kernel.
