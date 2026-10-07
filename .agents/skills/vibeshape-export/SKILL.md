---
name: vibeshape-export
description: Save editable VibeShape backups, export committed STEP/STL/3MF files, or hand off a model to a desktop slicer. Use for CAD artifact delivery; printer operation, G-code production, and model publication require separate requested workflows.
---

# VibeShape export

Use [vibeshape-use](../vibeshape-use/SKILL.md) for session setup. Establish the intended saved model/revision before exporting; an exact preview does not persist a draft. Read [print preparation and handoff](references/printing.md) only when preparing a print or opening a slicer.

## Choose the artifact

| Need | Artifact |
| --- | --- |
| Editable VibeShape project with authored history | Native `.vshape` through `prepare_project_backup` or the editor's project-file controls |
| Exact geometry for another CAD application | STEP |
| Unit-aware mesh interchange for slicing | 3MF |
| Mesh compatibility with an STL-only consumer | STL; explicitly state coordinates are mm |

STEP/STL/3MF are geometry exports, not native editable backups. Browser autosave remains tied to that browser origin/profile. Native **Open project (.vshape)** imports a separate copy; use it for restoring/transferring authored intent, and inspect the resulting copy before editing. Do not substitute a mesh export for a requested editable project.

## Shared MCP file transfer

When advertised, use `prepare_model_export` with exact committed `revision` and STEP/STL/3MF
`format`, or `prepare_project_backup` for an editable `.vshape`. These tools work through local
and paired remote MCP, accept no destination path and export the committed document.

For STL/3MF, optionally pass `meshQuality: { chordTolerance, angularTolerance }` with absolute
chord tolerance in millimeters (`0.005`–`1`) and angular deflection in radians (`0.01`–`0.5`).
Omit it to preserve existing export defaults: STL `0.05 mm / 0.1 rad`, 3MF `0.02 mm / 0.1 rad`.
Smaller tolerances increase curved-surface detail and file size; transfer and print budgets still
apply. Imported triangle meshes retain their source resolution. STEP rejects mesh quality.

Save the returned descriptor, then call `read_export_chunk` with its `exportId`, byte `offset`
and optional `limit` up to `chunkMaxBytes`. Decode each base64 chunk using ordinary client file
tools, append bytes in offset order and follow `nextOffset` until null. Verify final `byteLength`
and SHA-256 against the descriptor before reporting delivery. Keep binary output out of the
conversation; do not save base64 text under a CAD extension. Finish with `discard_export`.

Files are limited to 6 MiB and expire after five minutes without renewal. Only one prepared file
exists per paired actor; preparing another evicts it. Disconnect or project replacement removes
access. A later model edit does not alter detached bytes; the descriptor identifies the exported
revision. Pace remote reads under its ordinary operation rate limit and remaining session budget.
Use the browser workflow for larger files or explicit part selection. A descriptor alone is not
a delivered file.

## Legacy local MCP export

When `export_model` is advertised, call it with the exact committed `revision` and `format: "step"`, `"stl"`, or `"3mf"`. It accepts no file path and exports the committed model, not a draft or a named part selector.
Its optional `meshQuality` follows the same STL/3MF contract as the shared chunk tools.

Read the returned `resource_link.uri` through MCP resources/read. Decode the base64 blob and save the bytes with the client's ordinary file tools at the requested destination. Do not save base64 text under the geometry extension or print the blob into conversation. Current resource limit is 6 MiB and lifetime is five minutes; revoking pairing removes access. Read and save promptly.

Use the resource's filename/MIME type and revision to identify the result. Resolve an existing destination without silently overwriting unrelated work. A resource link alone is not a delivered file. Inspect saved file size/format when needed; re-import or open it in the intended consumer when interoperability is part of acceptance.

## Remote and browser export

Remote omits the legacy `export_model` binary resources; use the shared chunk tools above when
advertised. The editor's **Export model** dialog supports STEP/STL/3MF, and project-file controls
support `.vshape`. Select explicit part scope in the visible dialog when requested; hidden parts
can still be included in all-body export. Wait for ordinary saves or active CAD work to finish first.
The dialog, assembly export and **Prepare print** expose **Mesh quality** choices. **Default**
preserves each path's existing tessellation; **Coarse** uses `0.2 mm / 0.3 rad`, and **Fine**
uses `0.01 mm / 0.05 rad`. Quality changes only the disposable mesh, not authored geometry.

Use the host's download/file handling to establish the final file path. If the browser tools cannot retrieve a download, have the person complete that download and report the exact gap; do not claim delivery based on a button click. No direct storage access or internal script invocation is a substitute for the supported export path.

Finish with the artifact path or accessible delivery link, format/units, and the material validation result. Opening a slicer, obtaining G-code, uploading a public model, and physical printing are distinct outcomes.
