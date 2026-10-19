# ADR-0111: Native Project Assistant and Desktop Handoffs

- Status: Accepted
- Date: 2026-10-19
- Partially supersedes: [ADR-0110](0110-macos-desktop-host.md) for IPC and MCP availability;
  [ADR-0020](0020-local-slicer-handoff-bridge.md) for the product slicer workflow

## Decision

Keep CAD, storage, exact preview, and reviewed commits in their existing owners. Add narrow typed
native capabilities through a sandboxed, context-isolated preload. It exposes no filesystem, shell,
generic IPC, or Node API. Main validates the exact owned editor main frame and each request before
native work. Plugin frames, license windows, and unrelated same-origin windows have no authority.
Native menus invoke registered editor commands and respect their eligibility. The macOS header
reserves native traffic-light space and separates draggable regions from interactive controls.

### MCP attachment

Run the existing adapter and browser broker on the app's exclusive loopback server. A private
per-launch credential and descriptor authorize one attached client. The bundled stdio forwarder
uses Electron's embedded Node runtime; external clients need no Bun or Node installation. Settings
copies its launch configuration, never the bearer credential. Discovery does not grant document
access: the person enables the AI session for the current project. Revocation and replacement retain
the existing draft/review lifecycle. See [ADR-0043](0043-local-stdio-mcp-browser-session.md).

### Project chat

An installed ACP agent runs as a local subprocess through the stable ACP SDK. Explicit connection
selects its executable and arguments. Project IDs and fresh session tokens scope streaming,
permissions, cancellation, and restoration. ACP receives the same MCP launch configuration and
cannot bypass CAD authorization or grant itself auto-apply consent. Native CAD tools preserve the
person's existing explicit MCP approval policy; direct browser API tools always require manual Apply.
Client filesystem and terminal capabilities are not advertised;
the external agent retains ordinary OS user privileges and is not an application sandbox.

Static web chat connects directly to a user-supplied compatible model API. Credentials stay in
runtime memory; endpoint/model preferences may persist. No VibeShape AI worker, proxy, or relay is
required. Browser tools reuse local automation and reviewed commands. A browser cannot spawn stdio
agents or expose its project as a reachable MCP server without an additional runtime. Existing CAD
WebWorkers remain local computation. Development MCP retains [ADR-0096](0096-development-http-mcp.md).

Bounded transcripts persist per local project. Saved text is distinct from native agent context;
session restoration is attempted only when advertised.

### Mesh handoff

The Mac app discovers installed slicers and accepts explicit native application selection. Renderer
requests use opaque target IDs. Main saves bounded private STL/3MF bytes and opens the chosen target
with argument arrays. There is no separate bridge, pairing process, shell, slicing service, or
printer traffic. Failed launch preserves a mesh accessible through an opaque Finder-reveal action.
Retention and storage budgets are bounded. Static browsers download meshes for manual opening. The
old bridge CLI remains an explicit compatibility tool outside the required product UI.

## Acceptance

Require native stdio discovery and consent/revocation, owned-frame IPC isolation, ACP lifecycle tests,
browser tool review, actual chrome/menu checks, and slicer failure/file-ownership tests. Preserve
corresponding sources and notices. Slicer launch does not establish import, slicing, or printing.
Signing/notarization and update publication retain their separate release gates.
