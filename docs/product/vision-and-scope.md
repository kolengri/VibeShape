# Product vision and scope

## Recommendation

Build a **local parametric CAD system for makers and functional FDM/SLA printing**, not a general-purpose PLM platform. VibeShape's differentiators are privacy, offline operation, understandable printability feedback, and free software—not Onshape-style collaboration.

## Problem

3D-printer users often need mechanically accurate parts such as enclosures, brackets, adapters, jigs, and gears with editable dimensions. Mesh editors are awkward for this work, desktop CAD systems are heavy, and cloud CAD requires an account and file uploads.

VibeShape should let a user design such a part in a modern browser, close the tab, return offline, change a parameter, and produce a correct 3MF/STEP/STL without uploading the project.

## Target audience

Primary audience:

- FDM/SLA printer owners;
- makers, teachers, and students;
- electronics and enclosure designers;
- small workshops that need simple local-first CAD;
- authors of parametric models.

Not a primary v1 audience:

- large engineering organizations;
- complex Class-A surface modeling;
- industrial CAM/CAE;
- regulated PDM/PLM workflows;
- large assemblies and standards-heavy engineering drawings.

## User jobs

1. Create a part from a fully constrained 2D sketch.
2. Change a key dimension and get a predictable rebuild.
3. Import a STEP component as a reference and design a mating part around it.
4. Check dimensions, closure, minimum features, and overhang risks.
5. Export 3MF/STL to a slicer and STEP to another CAD system.
6. Store and transfer the project as a normal file without an account.

## Product principles

- **Local-first.** Working data belongs to the user and remains available without a network.
- **Parametric-first.** History, dimensions, and dependencies matter more than direct polygon editing.
- **Exact before mesh.** B-Rep is the source of truth; meshes are representations and exports.
- **3D-print aware.** Units, tolerances, build volume, and print checks are part of the workflow.
- **Honest failure.** Boolean, solver, and reference failures are explained; geometry is never silently substituted.
- **Portable.** Projects use a documented container and derived geometry uses open formats.
- **Keyboard and accessibility aware.** Core commands are keyboard-accessible and never depend on color alone.

## v0.1 alpha scope

Users can:

- create, rename, duplicate, import, export, and delete local projects;
- work offline after the first successful application load;
- sketch on the XY, XZ, and YZ origin planes;
- use lines, polylines, rectangles, circles, arcs, and construction geometry;
- apply fundamental geometric constraints and driving dimensions;
- perform extrude/pad, pocket/cut, revolve, boolean, fillet, and chamfer operations;
- edit or suppress a feature and rebuild downstream features;
- inspect the feature tree, properties, errors, and warnings;
- measure distance, angle, radius, area, and volume;
- import STEP and STL as distinct data types;
- export STEP, 3MF, and STL;
- run basic printability checks and select a printer/build-volume profile;
- recover a document after an unexpected close.

## v0.1/v1 non-goals

- real-time collaboration, comments, and user presence;
- server-side computation or mandatory synchronization;
- assemblies, mates, BOMs, and drawings;
- a complete built-in slicer or G-code generation;
- CAM, FEA, rendering, animation, and sculpting;
- proprietary SolidWorks, Parasolid, or Inventor imports;
- treating imported STL as editable B-Rep;
- complex authoring on phones; view-only behavior is acceptable;
- native-format compatibility with Onshape.

## Alpha success metrics

| Metric | Target |
|---|---|
| First bracket from empty project to 3MF | Under 15 minutes without documentation |
| Confirmed operations lost after a crash | No more than the latest autosave transaction |
| Early-dimension changes in reference models | At least 95% rebuild or report the exact failure cause |
| Export validity | Every release fixture opens in two independent slicers |
| Networking after PWA installation | Core CAD functions work while forced offline |
| UI during CAD computation | Input and navigation remain responsive |

Performance targets are refined on a defined reference machine after Phase 0.

## Core demonstration scenario

The alpha reference model is a parametric angle bracket:

- dimensioned base sketch;
- extrude;
- second sketch and pocket;
- holes and linear pattern;
- fillet/chamfer;
- edits to thickness, center distance, and hole diameter;
- printability report;
- STEP and 3MF export;
- close, offline restart, and recovery.

This scenario becomes the first end-to-end acceptance fixture and remains versioned.
