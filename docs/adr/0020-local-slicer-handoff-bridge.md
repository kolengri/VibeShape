# ADR-0020: Authenticated local slicer handoff bridge

- Status: Accepted
- Date: 2026-08-09

## Context

VibeShape can generate a valid 3MF entirely in the browser, but a browser-generated `Blob` has no stable filesystem path that a web application can pass to an arbitrary desktop program. Browser downloads intentionally hide the final local path. Web Share leaves target selection to the user and does not allow VibeShape to remember or preselect a slicer. Vendor URL schemes are inconsistent and generally require an independently retrievable HTTPS file rather than bytes owned only by the local browser session.

The product therefore needs an explicit native boundary to deliver local bytes to an installed slicer. This boundary must not become a general command runner, cloud upload path, printer controller, or privileged CAD backend.

## Decision

Add an opt-in, open-source Bun application named VibeShape Slicer Bridge and a strict shared browser-to-bridge protocol.

The product UI presents one primary **Open in slicer** action, remembers the selected supported slicer in browser-local preferences, and exports the active rebuilt revision once as 3MF. The initial allowlist is OrcaSlicer, Bambu Studio, PrusaSlicer, Snapmaker Orca, and UltiMaker Cura. OrcaSlicer is the default only when no valid preference exists.

The bridge:

- binds only to fixed IPv4 loopback `127.0.0.1:43113`;
- pairs on first start with one exact HTTP or HTTPS VibeShape origin;
- generates a 256-bit base64url bearer token, stores it in an owner-only configuration file where the platform supports modes, and prints it for explicit entry in the browser;
- requires exact `Host`, port, `Origin`, bearer credential, method, path, metadata, content type, and protocol version on every handoff;
- returns CORS only for the paired origin, handles Private Network Access preflight, and never uses wildcard origins;
- accepts at most 128 MiB of raw `model/3mf` bytes, verifies the ZIP local-header signature, and never accepts a filesystem path or executable from the browser;
- serializes handoffs, limits attempts to 10 per minute, and deduplicates successful request UUIDs for five minutes;
- resolves only allowlisted slicer executables from reviewed platform paths, `PATH`, or slicer-specific absolute environment overrides;
- launches the exact argument array `[executable, temporary3MfPath]` through `Bun.spawn` without a shell;
- writes into an owned temporary directory with owner-only permissions, schedules successful and failed-launch files for cleanup, and removes stale owned handoff directories on startup;
- never exposes temporary paths in HTTP responses and never starts slicing, emits G-code, selects printer settings, uploads a file, or sends a print job.

The browser stores the bridge credential only after explicit connection and sends it in the `Authorization` header, never in a URL. Requests omit ambient credentials, referrer data, and caching. A five-second client timeout bounds an unavailable bridge.

If the bridge is unpaired, unreachable, rejects the credential, cannot find the selected slicer, or otherwise fails, VibeShape downloads the already generated 3MF and tells the user exactly that it downloaded instead of claiming the slicer opened. A browser-storage failure does not block export. Direct 3MF, STEP, and STL download remain available.

Source execution is implemented first. Signed installers, background startup, platform code signing, automatic updates, and packaged executable discovery are release-packaging work and do not change this protocol authority.

## Consequences

- One click opens the generated file in a remembered installed slicer when the explicitly paired bridge is running.
- CAD bytes remain on the device and cross only a fixed loopback boundary.
- An XSS in the paired VibeShape origin could use the stored credential, so CSP and application-origin integrity remain critical.
- Self-hosted origins need explicit bridge pairing and deployment CSP permission for the exact loopback endpoint.
- A stopped or unsupported bridge degrades to a useful download instead of blocking the print workflow.
- The bridge is a separate local process and requires platform packaging before non-developer release distribution.

## Rejected alternatives

- **Infer the browser download path:** browsers deliberately do not expose it to web applications.
- **Use Web Share and remember the target:** the user agent owns the target chooser; a site cannot preselect a desktop application.
- **Use vendor URL schemes directly:** support and payload contracts differ, local browser bytes are not generally addressable, and arbitrary scheme navigation provides weaker diagnostics and policy control.
- **Upload 3MF to a VibeShape service for a deep link:** violates the local-first default and introduces availability, privacy, retention, and authentication obligations.
- **Accept an executable or command line from the browser:** turns the bridge into a command-execution primitive and creates shell-injection and persistence risk.
- **Send directly to a printer:** printer selection, slicing profiles, G-code review, and machine safety require a separate explicit workflow.
