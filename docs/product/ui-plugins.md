# Local UI plugins

Open **VibeShape → Plugins…** to install a local `.vsui.json` package. **Download example plugin**
provides a print-fit calculator. Choose that downloaded file, review its identity and capabilities,
then choose **Install and enable**. Its command opens an isolated panel inside the manager. Enter
values and choose **Calculate**; the example computes bore diameter from part diameter and twice
the radial clearance.

Installed packages and enabled permissions persist only in the current browser profile. Mutations use
native Web Locks to serialize installation, revocation and reset across tabs; browsers without this
capability can read the list but cannot change installations or permissions. Reload opens
no panels. **Disable** revokes use, **Remove** deletes that package, and closing the manager disposes
the active panel. Store corruption or unavailable storage produces an explicit error; **Clear installed
plugins** recovers only plugin data. Project documents are unaffected.

The initial profile supports commands opening interactive numeric calculator panels. A package is
UTF-8 JSON with experimental `schemaVersion: 1` and `profile: "declarative-ui"`, a reverse-domain ID,
semantic version, name, description, license, and exactly `ui.command` and `ui.panel` capabilities.
Use the downloaded example as a complete authoring template; its `commands` refer to declared panel
IDs. Each output is its `constant` plus the sum of `coefficient × input` terms. No expression strings
are evaluated.

Limits are 64 KiB per package, 16 installed packages, four commands and four panels per package,
eight numeric inputs and outputs per panel, and eight terms per output. Inputs have finite ordered
bounds, a valid default and positive step. Duplicate identifiers, unknown keys/capabilities and missing
references are rejected. The original file bytes determine its SHA-256 integrity. A different file
cannot silently replace an installed ID/version; change its version or remove the existing package.

These plugins receive no document, geometry, network, storage, clipboard, filesystem or MCP access.
Package data contains no HTML, JavaScript, WebAssembly or remote resources. The host's reviewed panel
renderer executes in an opaque sandbox through a bounded MessagePort protocol. Package-provided units
and calculator advice are independent of project display-unit settings and do not certify a physical
fit.

Arbitrary executable plugins, custom parametric CAD features, codecs, catalogs and a stable public SDK
remain future work. This profile does not publish the private extension-spike API. See
[ADR-0109](../adr/0109-local-declarative-ui-plugins.md) and
[Extension architecture](../architecture/extensions.md).
