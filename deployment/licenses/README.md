# Bundled notice provenance

The Vite build uses `rollup-plugin-license` 3.7.1 to scan included browser and worker modules.
Both inventories retain package name/version, complete license text and any discovered NOTICE.
They are emitted as build assets so worker notices survive Vite output cleanup. Missing license
text fails the build; public staging also requires both inventories and the copied shadcn license.
The shadcn CLI version in this release's lockfile is 4.16.2; source-owned components follow ADR-0009.

Two source-owned supplements cover upstream packaging gaps:

- `react-remove-scroll-bar` 2.3.8 declares MIT but its npm archive omits LICENSE. The retained text
  comes from the maintainer's [LICENSE addition at commit 7301c160](https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE).
  The fallback applies only to that name, version and declared license.
- Replicad 0.23.1 already bundles dependencies into its distributed JavaScript. A module scanner
  cannot recover their individual package boundaries. Its [published source commit's lockfile](https://github.com/sgenoud/replicad/blob/45b9b8b7c594cd5dc38617edaf220ab4cd72778f/pnpm-lock.yaml)
  pins Flatbush 4.0.0, FlatQueue 2.0.3, OpenType.js 1.3.4, tiny-inflate 1.0.3 and
  string.prototype.codepointat 0.2.1. The supplemental file retains their full license texts.
  Flatbush/FlatQueue texts come from those exact npm archives, and the other texts from the exact
  installed versions. These embedded versions differ from VibeShape's later dependency resolution;
  the build requires a new review if Replicad's version changes.

Native OCCT/OpenCascade.js and SolveSpace licensing, source, changes, recipes and replacement
instructions remain in their verified corresponding-source archives. This notice inventory is
technical distribution evidence; it does not certify completion of the separate legal-review gate
in `docs/licensing.md`.
