# ADR-0153: glTF and OBJ export and the assembly bill of materials

- Status: Accepted
- Date: 2026-11-10

## Context

Model and assembly export offered exact STEP, binary STL and multi-object 3MF. Visual consumers
such as web viewers, AR tools, game engines and DCC applications expect binary glTF or Wavefront
OBJ with materials. The bundled replicad-opencascadejs WASM build has no RWGltf, RWObj or IGES
modules, so the kernel cannot write these formats, and adding OCCT modules would grow the WASM and
its corresponding-source bundle. Assemblies also lacked a bill of materials. Parts carry display
appearance presets that explicitly make no physical material claim; the only sourced densities are
the structural material catalog used by lightweighting.

## Decision

### Visual mesh formats

- `@vibeshape/formats` owns pure TypeScript writers, `gltf-meshes` and `obj-meshes`, over the same
  world-space millimeter triangle meshes that 3MF consumes. The document worker routes `glb` and
  `obj` through the 3MF print-mesh collection, so surface relief, mesh quality and imported meshes
  behave as for 3MF. Assembly export uses the placed occurrence meshes.
- `geometryExportFormatSchema` gains `glb` and `obj`. Slicer handoff stays limited to STL and 3MF.
- Each exported body becomes one glTF node and mesh, or one OBJ `o` group, named after its Part (or
  its assembly instance, numbered per source for multi-body definitions).
- Export bodies may carry a display-only appearance (sRGB color, metalness, roughness, opacity)
  resolved from the live Part appearance. Assembly definitions do not freeze display data, so the
  controller attaches the live appearance of each frozen Part source at the exported revision.
  Bodies without an appearance share one neutral default material. Equal appearances share one
  material in first-use order.
- glTF units are meters: positions are scaled by 0.001. VibeShape is right-handed Z-up and glTF is
  right-handed Y-up, so positions map `(x, y, z) → (x, z, −y)`, a −90° rotation about X that keeps
  handedness and triangle winding. The mapping is baked into the vertex data with an identity node
  transform so accessor bounds describe stored values. `baseColorFactor` is the linearized sRGB
  color; opacity below 1 selects `BLEND`.
- The GLB writes UInt32 indices, Float32 positions with exact Float32 `min`/`max`, four-byte aligned
  buffer views, a space-padded JSON chunk and a zero-padded BIN chunk. Normals are omitted, so
  conforming viewers derive flat normals; no UVs or textures are written.
- OBJ keeps millimeters and Z-up axes, matching STL and 3MF. Coordinates use at most six decimals
  without exponents; face indices are global and one-based. `usemtl` references an MTL library of
  display colors with `Kd`, `d`, `Pr` and `Pm`. Because a separated OBJ loses its colors, OBJ is
  always delivered as a deterministic ZIP (`model.obj` plus `model.mtl`, fixed 1980 timestamps)
  using the existing `fflate` dependency; the download and MCP descriptor name it `.zip` with
  `application/zip`.
- Identical input produces identical bytes: no timestamps, generator version strings or
  object-identity-dependent ordering enter either file.

### Bill of materials

- `@vibeshape/domain/assembly-bom` derives one row per frozen definition that has at least one
  instance, in definition order. Quantity is the number of instances referencing the definition.
  The assembly model is flat: there are no nested sub-assemblies or patterned occurrences to expand.
- Volume is exact evidence from assembly inspection, which now reports the source solid `volume`
  for exact occurrences. A definition's unit volume is the sum over its sources and is unknown when
  any source is a triangle mesh or lacks evidence.
- Density comes only from an explicit structural catalog material per definition. Appearance
  presets never imply density. Mass is `volume × density × 1e-6` grams; otherwise it is unknown and
  displayed as "—" or `null`. Catalog densities describe solid material and do not account for
  print infill.
- CSV follows RFC 4180: CRLF records, quoting of fields containing commas, quotes, CR or LF, and
  doubled quotes. Numbers use a dot decimal separator and fixed units. The file starts with a UTF-8
  byte-order mark so spreadsheet applications decode unit symbols and non-ASCII names. Free-text
  cells (part name, appearance, material) that start with `=`, `+`, `-`, `@`, tab or CR get a
  leading apostrophe before quoting, because spreadsheets evaluate such cells as formulas even when
  quoted; numeric columns are never altered.
- The assembly workspace shows the BOM in a dialog with an accessible table and per-row material
  selection. Material choices are view state and are not persisted in the document.
- MCP adds the read-only `model_assembly_bom` tool over the same domain function and exact
  inspection, accepting explicit `materials` per definition.

## Consequences

- No WASM, kernel or document schema change is needed; the formats are testable without OCCT.
- Visual exports are tessellations, not exact geometry; they inherit print-mesh tolerances.
- Flat shading omits smooth normals; consumers needing smooth shading must recompute them.
- glTF scene structure does not preserve assembly hierarchy or instancing: each occurrence is
  written as placed geometry.
- BOM mass requires an explicit material choice each session. Persisting a physical material per
  Part would require a document schema change and is deferred.
- IGES remains blocked by the missing IGES module in the bundled WASM build.
- The geometry engine's `exportDocument` input keeps its `Exclude<GeometryExportFormat, "3mf">`
  format type, which now nominally admits `glb`/`obj`. The worker routes those formats before the
  kernel call, and `engine.ts` is content-hash pinned by the unit-test cache policy, so narrowing
  the type for this latent issue is deferred to a change that already revises that file.
- `DOCUMENT_PROTOCOL_VERSION` is unchanged: the new export formats, export-body appearance,
  assembly source appearances and occurrence volume are additive optional fields, and the browser,
  document worker and geometry worker ship in one bundle.
- Older builds that receive a `glb`/`obj` preference or request reject it through their existing
  schemas; they cannot be changed retroactively.
