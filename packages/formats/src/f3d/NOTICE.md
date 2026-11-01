# F3D reader provenance

The binary archive, design-record and ASM/B-rep readers and STEP writer in this
folder are adapted from Extrudo, commit
`c05d910395f514f4810d3fc76504ce6bb1c73da8`, `packages/f3d/src`:
<https://github.com/zoltanf/extrudo>. Original copyright remains with the
Extrudo contributors. These sources are GPL-3.0-or-later, compatible with
VibeShape's GPL-3.0-or-later license (see the repository `LICENSE`). VibeShape's
mapping, worker integration, stricter archive validation and tests are changes
from the original implementation. No proprietary vendor SDK is included.

`FORMAT.md` is retained from that commit. It credits the cadmpeg contributors'
format specification, licensed CC BY 4.0:
<https://github.com/cadmpeg/cadmpeg/blob/main/docs/formats/f3d.md>.
See <https://creativecommons.org/licenses/by/4.0/>. The document was reworded,
reorganized and extended by Extrudo; VibeShape adds this provenance notice and
documents its own narrower mapping separately. Its upstream corpus claims do
not describe VibeShape verification.

The existing `fflate` and added `fzstd` dependencies retain their own licenses;
they are not relicensed by this notice. No sample CAD files from third parties
are bundled. Parser fixtures are synthetic test data.
