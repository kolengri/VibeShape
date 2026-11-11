---
name: vibeshape-export
description: Save editable VibeShape backups, export committed STEP/STL/3MF/GLB/OBJ files, or hand off a model to a desktop slicer. Use for CAD artifact delivery; printer operation, G-code production, and model publication require separate requested workflows.
---

# VibeShape export

Use [vibeshape-use](../vibeshape-use/SKILL.md) for session setup. Establish the intended saved model/revision before exporting; an exact preview does not persist a draft. Read [print preparation and handoff](references/printing.md) only when preparing a print or opening a slicer.

## Choose the artifact

| Need | Artifact |
| --- | --- |
| Editable VibeShape project with authored history | Native `.vshape` through `prepare_project_backup` or the editor's project-file controls |
| Presentation image of visible committed bodies | `prepare_picture_render`; see [picture rendering](references/picture-render.md) |
| Exact geometry for another CAD application | STEP |
| Unit-aware mesh interchange for slicing | 3MF |
| Mesh compatibility with an STL-only consumer | STL; explicitly state coordinates are mm |
| Colored model for web viewers, AR or game engines | GLB (binary glTF 2.0): meters, Y up, part appearance as PBR material |
| Colored mesh for DCC tools that read Wavefront OBJ | OBJ: ZIP holding `model.obj` and `model.mtl`, millimeters, Z up |
| Editable TypeScript recipe of supported modeling History | `export_design_recipe` at the exact committed revision, or **Scripts and macros… → Export design as script** |

Native backups of projects with disconnected History inputs use `.vshape` V6 and retain the original repair recipes, downstream items, and suspended Part identities. Open them in a V6-capable editor; older readers reject this authority rather than silently dropping repair state. Geometry exports require a successfully rebuilt model.

TypeScript recipe export is read-only on local and paired remote MCP, returning at most 128 KiB
source with document/revision context. Save the returned `source` as `.ts`; the editor supports larger
downloads. Unsupported assets/imports, topology-bound references, assemblies, textures, custom part
metadata and retained repair History refuse export; deliver native `.vshape` for complete preservation.
The editor can run TypeScript loops/Math in an isolated interpreter, preview and replay one atomic
Undo transaction, and record new History identities plus their dependency closure. Existing-item
edits are not recorded. Script source is downloadable/session-only; applied results are ordinary
features without associative source reruns. MCP exports source but does not run or apply it. See the
[Scripts and macros workflow](https://github.com/kolengri/VibeShape/blob/main/docs/product/scripts-and-macros.md).

STEP/STL/3MF/GLB/OBJ are geometry exports, not native editable backups. Browser autosave remains tied to that browser origin/profile. Native **Open project (.vshape)** imports a separate copy; use it for restoring/transferring authored intent, and inspect the resulting copy before editing. Do not substitute a mesh export for a requested editable project.

## Shared MCP file transfer

When advertised, use `prepare_model_export` with exact committed `revision` and
`format: "step" | "stl" | "3mf" | "glb" | "obj"`, or `prepare_project_backup` for an editable
`.vshape`. These tools work through local
and paired remote MCP, accept no destination path and export the committed document.

For mesh formats (STL/3MF/GLB/OBJ), optionally pass `meshQuality: { chordTolerance, angularTolerance }` with absolute
chord tolerance in millimeters (`0.005`–`1`) and angular deflection in radians (`0.01`–`0.5`).
Omit it to preserve existing export defaults: STL `0.05 mm / 0.1 rad`; 3MF, GLB and OBJ use the
print-mesh tessellation, `0.02 mm / 0.1 rad`.
Smaller tolerances increase curved-surface detail and file size; transfer and print budgets still
apply. Imported triangle meshes retain their source resolution. STEP rejects mesh quality.

GLB and OBJ write one node/object per exported body, named after its Part, and one material per
distinct part appearance (display color, metalness, roughness, opacity; no physical material claim).
Bodies without an appearance share a neutral default. GLB converts millimeters to meters (×0.001)
and maps VibeShape Z-up to glTF Y-up as `(x, y, z) → (x, z, −y)`; it carries flat-shaded positions
without normals or UVs, and its color factors are linear. OBJ keeps millimeters and Z-up axes and is
delivered as `model.zip` (`application/zip`) containing `model.obj` and its referenced `model.mtl`.
Surface relief layers are included like 3MF. Neither format is a slicer handoff target.

Save the returned descriptor, then call `read_export_chunk` with its `exportId`, byte `offset`
and optional `limit` up to `chunkMaxBytes`. Decode each base64 chunk using ordinary client file
tools, append bytes in offset order and follow `nextOffset` until null. Verify final `byteLength`
and SHA-256 against the descriptor before reporting delivery. Keep binary output out of the
conversation; do not save base64 text under a CAD extension. Finish with `discard_export`.

Files are limited to 6 MiB and expire after five minutes without renewal. Only one prepared file
exists per paired actor; preparing another evicts it. Disconnect or project replacement removes
access. A later model edit does not alter detached geometry/backup bytes; the descriptor identifies the exported
revision. Derived PNGs are revoked after revision or authored appearance/visibility changes. Pace remote reads under its ordinary operation rate limit and remaining session budget.
Use the browser workflow for larger files or explicit part selection. A descriptor alone is not
a delivered file.

## Legacy local MCP export

When `export_model` is advertised, call it with the exact committed `revision` and `format: "step"`, `"stl"`, `"3mf"`, `"glb"`, or `"obj"` (OBJ arrives as a ZIP with its MTL). It accepts no file path and exports the committed model, not a draft or a named part selector.
Its optional `meshQuality` follows the same mesh-format contract as the shared chunk tools.

Read the returned `resource_link.uri` through MCP resources/read. Decode the base64 blob and save the bytes with the client's ordinary file tools at the requested destination. Do not save base64 text under the geometry extension or print the blob into conversation. Current resource limit is 6 MiB and lifetime is five minutes; revoking pairing removes access. Read and save promptly.

Use the resource's filename/MIME type and revision to identify the result. Resolve an existing destination without silently overwriting unrelated work. A resource link alone is not a delivered file. Inspect saved file size/format when needed; re-import or open it in the intended consumer when interoperability is part of acceptance.

## Remote and browser export

Remote omits the legacy `export_model` binary resources; use the shared chunk tools above when
advertised. The editor's **Export model** dialog supports STEP/STL/3MF/GLB/OBJ, and project-file controls
support `.vshape`. Select explicit part scope in the visible dialog when requested; hidden parts
can still be included in all-body export. Wait for ordinary saves or active CAD work to finish first.
The dialog, assembly export and **Prepare print** expose **Mesh quality** choices. **Default**
preserves each path's existing tessellation; **Coarse** uses `0.2 mm / 0.3 rad`, and **Fine**
uses `0.01 mm / 0.05 rad`. Quality changes only the disposable mesh, not authored geometry.
Assembly GLB/OBJ export places each occurrence in world coordinates, names it after its instance
(numbered per source for multi-body definitions) and uses the live appearance of each frozen Part
source; asset-output sources keep the default material.

Use the host's download/file handling to establish the final file path. If the browser tools cannot retrieve a download, have the person complete that download and report the exact gap; do not claim delivery based on a button click. No direct storage access or internal script invocation is a substitute for the supported export path.

Finish with the artifact path or accessible delivery link, format/units, and the material validation result. Opening a slicer, obtaining G-code, uploading a public model, and physical printing are distinct outcomes.
