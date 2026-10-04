# ADR-0096: Development HTTP MCP on the Vite Origin

- Status: Accepted
- Date: 2026-10-04
- Related: [ADR-0043](0043-local-stdio-mcp-browser-session.md), [ADR-0095](0095-local-mcp-continuous-recovery.md)

## Decision

`bun run dev` starts Vite and a Streamable HTTP MCP endpoint at `/mcp` in one process. A Vite
development plugin mounts the existing local MCP adapter and browser broker, and advertises the
bridge through the same HTML meta element used by the built stdio editor. It introduces no CAD,
document, draft, persistence, or approval implementation.

This extends ADR-0043's ordinary-development-editor exclusion only for the source dev server.
The production stdio transport and explicitly paired remote HTTPS transport retain their contracts.
Production builds and preview do not import the development plugin. Vite development runs under
the pinned Bun runtime to resolve server-side TypeScript workspace exports; builds retain their
existing pipeline. Browser and Vite configuration use separate TypeScript environments.

## Authority and lifecycle

The server binds to a loopback host and rejects non-loopback and HTTPS dev configurations.
Requests require the exact development Host and, when supplied, Origin. No CORS permission is
granted. The endpoint prints its actual port, including Vite fallback ports. Browser-local projects
remain scoped to that origin. The default `localhost` host preserves existing dev projects.

One stateful HTTP client owns one local broker. Initialization reserves the client before any
asynchronous protocol work, preventing concurrent takeover. Another initialization receives 409;
the owner must terminate its HTTP session or the developer must restart the server. Unknown HTTP
session IDs receive 404. POST bodies are bounded to 256 KiB with five-second read deadlines and
eight concurrent local requests. POST SSE responses carry tool results and progress; standalone
GET SSE is unavailable. Existing browser request, tool, export, approval, and liveness limits apply.

Tool discovery and session/authoring resources work before pairing. Document access still requires
the person to enable AI in the intended project. HTTP DELETE and server shutdown revoke browser
authority, cancel pending work, clear temporary exports, and close the MCP transport. The dev
bridge is memory-only and does not write stdio recovery credentials; server restart requires a
fresh MCP initialization and approval.

## Consequences

An HTTP-capable MCP client can use the hot-reloading editor without a separate production build
or process-spawned stdio connection. Development HTTP remains a single-client loopback workflow,
not a multi-client or public MCP service. Export resources and operator guidance reuse the local
adapter. A session resource, rather than a guessed default URL, remains authoritative for pairing.
