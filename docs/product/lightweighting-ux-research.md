# Lightweighting interaction research

The editor offers two source-bound workflows in the normal responsive task panel. Graphical
selection replaces numerical region bounds in the structural workflow. The quick workflow
creates a connected gyroid mesh without asking users to invent support and load conditions.
Both add a separate mesh Part through ordinary import, leaving the exact source editable.

## Established CAD patterns

- [SOLIDWORKS preserved regions](https://help.solidworks.com/2021/english/SolidWorks/cworks/hidd_preserved_region.htm)
  select model faces and an inward preservation depth, with geometry and mesh feedback.
  This supports face selection plus one physical depth parameter rather than six coordinates.
- [Fusion structural loads](https://help.autodesk.com/cloudhelp/ENU/Fusion-GenerativeDesign/files/GD-APPLY-LOADS.htm)
  separate target selection, magnitude, and direction and display editable load glyphs.
  VibeShape uses selected faces, a total force, normal or axis direction, and signed arrows.
- [Fusion structural constraints](https://help.autodesk.com/cloudhelp/ENU/Fusion-GenerativeDesign/files/GD-STR-CONSTRAINTS.htm)
  make constraints explicit on the model. VibeShape distinguishes support, load, and preserved
  faces using semantic colors and lists that can be edited or cleared.
- [Fusion volumetric lattice](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-CREATE-VOLUMETRIC-LATTICE.htm)
  applies lattice patterns to solids, with cell and solidity controls and mesh conversion.
  This is the closest precedent for the quick material-removal workflow.

## Accepted interaction

The selected exact solid is prefilled. Structural analysis asks for a material preset,
a support face, a loaded face, and a visible force. Optional preserved faces and advanced
resolution controls follow. Regions remain bound to the captured pristine tessellation and
source revision; a source change invalidates them. The task never treats a curved face's
bounding box as the selected face. Small selections that cannot map to the finite-element
boundary fail explicitly.

The quick tool assumes a filled source solid. A switch chooses a preserved exterior with an
internal skin or an open organic structure. Sliders control requested removal, cell detail,
and skin thickness. Disposable generation is debounced; obsolete operations are canceled.
Results report measured volumes and achieved removal separately from the requested target.

Normal parameters live in the right task panel. On narrow displays it becomes the existing
collapsible sheet, exposing the canvas for picking. Required blocked-action explanations
remain adjacent to task actions; compact toolbar actions provide keyboard and touch disclosure.
Tooltips supplement these explanations.

## Limits

A load-free lattice cannot establish maximum stiffness under unspecified conditions. The quick
tool provides geometry evidence, not a structural score or manufacturing certification. The
structural tool remains a preliminary isotropic linear-elastic voxel analysis under explicit
material, support, and load assumptions. Its surface regions and preservation depth are
resolution-dependent. Gyroid detail, exterior skin, and connectivity can limit actual removal.

The Gyroid, Schwarz P, and Schwarz D fields use the nodal approximations in the Methods section
of [Nano-topology optimization for materials design with atom-by-atom control](https://www.nature.com/articles/s41467-020-17570-1).
The implementation thickens the absolute field into sheets; no physical strength ranking is inferred
from selecting a lattice family.
