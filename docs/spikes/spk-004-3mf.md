# SPK-004: Local 3MF interoperability

- Status: **Pass — minimal 3MF writer and slicer gate cleared**
- Recorded: 2026-08-08
- Scope: deterministic 3MF Core export, strict input limits, OPC/XML checks, and local slicer consumption

## Decision

Use a small project-owned 3MF Core writer in `@vibeshape/formats`, with `fflate` providing the browser-compatible ZIP implementation.

This keeps the semantic export contract, resource policy, XML output, and diagnostics under VibeShape ownership. It avoids adding a native or Node-oriented lib3mf binding to the browser path for the initial Core-only profile. Revisit lib3mf or another adapter if future extensions make the project-owned surface materially larger or harder to validate.

SPK-004 clears the minimal 3MF Phase 0 gate. SPK-001 already covers browser-generated STEP and binary STL for the same early format track. Production tessellation orchestration, export UI, broad format corpora, and hostile import handling remain later work.

## Implemented contract

`@vibeshape/formats/three-mf` exports:

- strict Zod schemas for the versioned writer input and export report;
- a deterministic synchronous `writeThreeMf` operation suitable for a worker;
- millimeter units and UTF-8 XML;
- mesh objects, component objects, component transforms, build items, names, part numbers, standard metadata, and PNG or JPEG thumbnails;
- the required OPC content types, start relationship, and 3D model part;
- fixed ZIP timestamps and stable entry/XML ordering.

The same semantic input produces byte-identical archive bytes. The writer does not insert the current time. Dates appear only when the caller supplies validated ISO timestamps.

## Fail-closed validation

The writer rejects input before allocating the archive when it encounters:

- non-finite coordinates or transforms;
- resource IDs or indices outside the Core integer range;
- missing, duplicate, or forward resource references;
- singular or orientation-reversing transforms;
- repeated, out-of-range, or zero-area triangle vertices;
- open edges, inconsistent edge orientation, or non-positive volume in any disconnected mesh component;
- duplicate build part numbers;
- XML 1.0-forbidden text;
- thumbnail bytes that do not match the declared PNG or JPEG media type;
- unknown object fields or values beyond the initial resource budgets.

Initial budgets are:

| Resource | Limit |
|---|---:|
| Objects | 10,000 |
| Vertices per mesh and total vertices | 1,000,000 |
| Triangles per mesh and total triangles | 2,000,000 |
| Components per component object | 100,000 |
| Build items | 10,000 |
| Thumbnail bytes | 20 MiB |
| Metadata or object text value | 4,096 Unicode code units |

The current writer accepts only positive-orientation transforms. Supporting a negative determinant would require deterministic triangle winding reversal and a new fixture matrix; silently emitting an inside-out model is not allowed.

## Local evidence

Run:

```bash
bun run formats:evidence:3mf
```

The runner rejects every truthy `CI` environment. No GitHub Actions workflow invokes it. Generated files and consumer logs remain ignored under `.artifacts/3mf-spike`.

The gate:

1. generates the fixture in Chromium through Vite;
2. generates it twice through Bun and requires all three outputs to be byte-identical;
3. unpacks the browser-produced artifact and requires the exact expected OPC parts;
4. rejects DTD and entity declarations and checks all XML parts with local `xmllint`;
5. invokes installed slicers through their CLI with isolated data directories where supported;
6. requires at least two consumer families, not merely two branded forks of the same family;
7. requires every consumer path to report 24 facets, only manifold meshes, and a total volume of `1,608 mm³`.

The recorded fixture contains two mesh resources, one component assembly, a non-identity component transform, one build item, metadata, and a PNG thumbnail.

| Measurement | Result |
|---|---:|
| Archive bytes | 1,575 |
| SHA-256 | `38c11ab212426e09c78ec9ef166ebf74c9da9ca8a7b07740eb405fcf591257ef` |
| OPC entries | 4 |
| XML parts checked | 3 |
| Objects / mesh objects / component objects | 3 / 2 / 1 |
| Vertices / triangles | 16 / 24 |
| Expected and observed volume | `1,608 mm³` |
| Independent consumer families | 2 |
| Browser producer | Chromium 151.0.7922.34 |

| Consumer | Recorded version | Family | Result |
|---|---|---|---|
| PrusaSlicer | 2.9.6 | PrusaSlicer / Slic3r | Pass; two manifold mesh reports sum to 24 facets and `1,608 mm³` |
| Snapmaker Orca | 1.10.01.50 | Orca/Bambu | Pass; transformed assembly reports 24 facets and `1,608 mm³` |
| Bambu Studio | 2.07.01.62 | Orca/Bambu | Supplementary pass; transformed assembly reports 24 facets and `1,608 mm³` |

Bambu Studio and Snapmaker Orca count as one family for the independence gate. PrusaSlicer supplies the second family.

On macOS the runner discovers these standard application paths. A developer may set `VIBESHAPE_PRUSASLICER_BIN` and `VIBESHAPE_ORCASLICER_BIN` to explicit executable paths; when either override is used, the configured set is authoritative.

## Export report

The versioned report records:

- media type and millimeter unit;
- object, mesh-object, component-object, and build-item counts;
- total vertices and triangles;
- thumbnail presence;
- final archive byte length.

It intentionally excludes current time, local file paths, slicer profiles, and vendor settings.

## Known limits and production follow-up

- The package writes 3MF; hostile 3MF import is not implemented.
- The initial profile has no materials, colors, textures, production extension, beam lattice, slice extension, or vendor-specific settings.
- The XML gate proves well-formedness and the project-owned Core profile; it is not a claim that every optional 3MF extension is supported.
- The slicer fixture is a small deterministic assembly, not a broad real-world corpus.
- Consumer CLI output differs: PrusaSlicer reports the two source meshes separately, while the Orca/Bambu family reports the transformed assembly. The invariant totals agree.
- Production export still needs worker integration with print-quality OCCT tessellation, progress/cancellation, save fallback, persistent diagnostics, and UI localization.
- Add release fixtures for brackets, enclosures, disconnected solids, large coordinates, Unicode metadata, and future material profiles.
- Add an official validator path when a current Core-only validator can be pinned without importing unrelated extension requirements.

These limits do not invalidate the Phase 0 result: two independent slicer families consume the deterministic Core archive and agree on its manifold facet and volume invariants.
