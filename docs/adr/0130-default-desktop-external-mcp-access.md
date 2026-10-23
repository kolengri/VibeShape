# ADR-0130: Default desktop external MCP access

- Status: Accepted
- Date: 2026-10-23
- Partially supersedes: [ADR-0115](0115-automatic-native-project-mcp-access.md) and [ADR-0126](0126-explicit-native-assistant-project-access.md) for copied desktop external client consent and restart UX

## Context

Copying the native host's MCP configuration deliberately attaches a local client to the already open
application. Requiring a second Enable AI session action prevents that client from reading the
current project despite successful authenticated discovery. The product now authorizes this desktop
connection by default. Standalone browser and development transports remain a separate trust boundary.

## Decision

The isolated desktop preload advertises a typed current-project access capability. The renderer
selects the desktop-external lifecycle only from that capability and requires the matching policy
from the desktop host's same-origin discovery endpoint. A query parameter, an assistant bridge,
standalone stdio, development HTTP, or remote MCP does not select this policy. The native external
attachment still requires its private copied-descriptor credential and accepts one external client.

Discovery or opening the current project automatically creates the ordinary external document
session. It uses manual Apply by default, never connected-assistant approval. Supported CAD
auto-apply still requires its separate explicit choice; project management remains a separate opt-in.
The embedded assistant keeps its existing private project attachment and connected model authority.
Actors, credentials, document capture, validation, exact previews and revision-safe commits stay
separate. Navigation revokes the previous external document scope before granting the new current
project; an authorized project-management command retains its existing guarded result handoff.

Desktop primary and secondary status controls have no initial Enable AI session option. Stop AI
revokes every current-project transport, aborts work, and rejects late grants. The external desktop
connection persists Stop in its own preference namespace, separate from browser and embedded
project preferences. That Stop also survives external namespace recreation, reload and navigation.
Unreadable or malformed state fails closed, and access reserves its Stop sentinel before granting.
Only the person's deliberate Restart local MCP in Settings > Connections can restart this external
connection. The built-in assistant still requires deliberate Connect after Stop. No MCP tool can
restore a stopped connection or change approval policy.

The first model_info on a never-granted desktop external attachment may use the existing bounded
five-second discovery wait. It does not defer writes, previews or exports. After a prior grant,
revocation, cancellation or owner replacement, unpaired reads fail immediately. Recovery reuses
bounded backoff and generation checks and never replays uncertain writes.

## Verification

Exercise a copied-descriptor-authenticated MCP client, production desktop host, renderer lifecycle,
and tool executor together: its first model_info succeeds without Enable and the document session
uses manual approval. Cover missing desktop host policy, assistant-bridge-only manual access,
primary/secondary status controls, deliberate Connections restart, persistent Stop across namespace
recreation, late grants after Stop, project replacement, and unchanged browser/native policies.
