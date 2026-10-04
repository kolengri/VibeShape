# Split body

Select a visible available part in Parts and choose **Split**. The task targets that part's exact
current body, including its semantic output role. Choose the XY, XZ, or YZ origin plane and a signed
unit-aware offset, with document variables supported. XY measures along Z, XZ along Y, and YZ along X.

A new task starts at the midpoint of the exact source body's Z bounds. Changing planes keeps the
entered offset. **Use body midpoint** explicitly centers the selected plane using its normal axis.
No plane choice silently translates the source model.

Version 2 supports authored Datum Planes, stable planar faces on exact named bodies, and explicit
world planes. Choose the current viewport face with **Use selected planar face**, or use the
**Reference source** control. Its signed offset follows the selected plane normal. Explicit direction
fields are normalized; zero directions and unavailable or ambiguous supports block Apply. The
midpoint action belongs to the origin-plane workflow. Supporting bodies are retained. Existing
version 1 records retain their original coordinate-axis offsets.

Preview is disposable. The plane must cross the source and produce exactly one connected valid solid
on each side. Missing, tangent, or disconnected-half cuts fail and block Apply. Cancel preserves the
committed document. Apply makes one ordinary transaction; editing its History row preserves feature
identity, raw expression intent, and the two part allocations. Undo/Redo and native Save/Open use the
shared document lifecycle.

The output roles are `split.negative` and `split.positive`, independent of OCCT traversal order. The
negative side continues the source part with its name, visibility, and preceding body history. The
positive side receives its own stable part ID and root history. A split targeting historical geometry
forks the negative side rather than consuming a later current tip. Each available side can be selected,
placed, mirrored, shelled, split again, or exported separately through its exact current body reference.
Legacy feature-only modifying tools do not list Split as one ambiguous result body.

The local and paired remote MCP tools `create_split` and `update_split` retain origin-plane version 1.
The additive `create_reference_split` and `update_reference_split` author version 2 with the shared
reference-plane contract. Both require exact `targetBody`, empty generic topology references, a
signed offset length quantity, fresh command ID and current owned draft revision. Version 2 declares
the target producer first, followed by any distinct support owner. Preview and ordinary
commit remain required; MCP has no additional document authority.
