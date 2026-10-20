# Presentation website

The independently built `apps/site` workspace introduces VibeShape, explains its modeling and MCP
workflows, provides six introductory documentation articles, and links to the hosted editor,
installation references, and GitHub releases. It uses the existing React, Vite, Tailwind, UI, and
typed English ICU catalog stack. It does not load the CAD kernel or access editor storage.

## Develop and verify

From the repository root, with the pinned Bun version installed:

```sh
bun install
bun run dev:site
bun run --cwd apps/site typecheck
bun run build:site
bun run test:site
```

Development uses `http://127.0.0.1:5180`; production preview uses port `4180`.
The browser tests run against the built site, so rebuild before testing changed source.
The site needs no API keys, hosted database, or model provider.

## Downloads and release maintenance

The downloads section links to the Apple Silicon macOS DMG and to the GitHub release index for
release notes, checksums, and source provenance. The package is ad-hoc signed and is not notarized
by Apple; the site states this beside the download. Intel Mac, Windows, and Linux installers are
not published. The separate OCCT source archive is not an application installer.

The downloads section fetches the public GitHub Releases API when mounted, independently of the
site build. It checks the first 100 releases and selects the most recently published non-draft,
non-prerelease `desktop-vX.Y.Z` release with an uploaded `VibeShape-X.Y.Z-mac-arm64.dmg` asset.
Technical releases and incomplete uploads are skipped. The displayed version and download URL
come from the same validated release; neither is pinned in the site bundle. Reloading the page
revalidates the API response, so publishing a new desktop release needs no site rebuild.

Until a release resolves, the action opens the GitHub release listing and shows no version.
That fallback remains available on network errors, API rate limits, an invalid response, an
eight-second timeout, or no matching installer within the first 100 releases. The browser calls
GitHub without credentials or API tokens; there is no proxy, polling, or persistent release cache.
The bundled Zod MIT notice is shipped at `third-party/zod-MIT.txt`.

To publish a desktop update, publish a stable `desktop-vX.Y.Z` GitHub release and upload its
`VibeShape-X.Y.Z-mac-arm64.dmg` asset. Verify the published asset and reload the site's downloads
section to check that its version and link match. Routine releases need no edits to site links,
catalogs, or browser-test fixtures and no site deployment. Changes to the tag or asset naming
contract, supported platforms, or signing status require the corresponding site code, copy,
tests, and deployment to be updated.

## Hero playback

The hero plays its silent six-second H.264 introduction independently of scrolling, then plays
the final two source seconds backward over three seconds, easing back to the exploded mechanical
housing at the four-second reference pose. Both directions are encoded in `media/hero-intro-return.mp4`;
the browser never seeks from the final pose to the reference pose. A separate eight-second,
60 fps H.264 loop moves slowly forward and backward with eased turns and a gentle vertical float.
The browser plays this loop normally, without per-frame timeline seeks. The hero stays in normal document
flow at every screen size. Playback pauses while the visual is outside the viewport or the tab is
hidden; returning resumes the introduction or the floating pose rather than restarting the story.
Reduced-motion preferences show `media/hero-model.jpg` without fetching the video, and media or
autoplay failures also leave that poster visible.

The original 3DBenchy mesh is CC0; its source and attribution are in `media/NOTICE.txt`. The remaining
geometry is a presentation illustration, not an editor recording. `media/hero-float.mp4` derives from
frames 109–131 of the original `media/hero-scroll.mp4`, with cosine timing, optical-flow interpolation,
and a reversed return path. The loop begins and ends at the four-second reference pose so switching
between the clips preserves the model's position. Both playback assets are encoded at 960 × 960,
with H.264/yuv420p and MP4 fast-start metadata. The hero itself
requires no Three.js or CAD runtime.

## Spatial illustrations

The printer illustration takes 2.4 seconds per layer, revealing all 17 layers over 40.8 seconds.
The head then lifts and parks over 2.4 seconds, completing the cycle in 43.2 seconds.
It stays finished when revisited. Feature diagrams, workflow stages, and agent steps animate once
when their block enters the viewport; selecting another workflow stage starts that stage's visual.
Reduced-motion preferences show completed static illustrations and keep all content visible.
These SVG/CSS illustrations use the existing theme tokens and do not load the CAD runtime.

## Interactive workflow model

The Shape stage lazy-loads the existing `@vibeshape/viewer` viewport once its preview enters the
viewport. Visitors can orbit a perforated mounting plate, use the editor's orientation inset,
select standard views, or Fit the model. Pointer focus enables zoom; unfocused wheel gestures
continue scrolling the page, and Escape releases focus. The site owns the responsive canvas host,
localized controls, loading state, and unavailable fallback. Changing workflow stages disposes
the preview and its render resources.

The committed STL is an original display-only demonstration, not an editable CAD document or a
manufacturing export. See [its dimensions, provenance, and reproduction recipe](../apps/site/public/models/README.md).
The preview reuses the editor's renderer and camera controls without loading the CAD kernel,
accessing editor storage, or creating a parallel document or command path. The bundled Three.js
MIT notice is shipped at `third-party/three-MIT.txt`.

## Social previews

The static HTML declares two 1200 × 630 PNG Open Graph images: `brand/og-light.png` is the
preferred preview and `brand/og-dark.png` is an alternate. Each has an absolute HTTPS URL,
MIME type, dimensions, and descriptive alt text. Twitter Cards use the light image with
`summary_large_image`. Crawlers receive all metadata without running JavaScript; fragment-based
documentation routes share the site's preview. The browser tests verify both image files and
metadata with JavaScript disabled.

## Automatic GitHub deployment

`.github/workflows/presentation-site.yml` builds, checks, and deploys the presentation after every
push to `main`. It can also be dispatched manually on `main`. Every main push triggers a run so
a newer unrelated commit cannot strand a site update rejected by the current-main source check.

The workflow uses the existing `cloudflare-production` environment and its account-scoped
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. It explicitly targets `vibeshape-site`; the
editor's `CLOUDFLARE_PAGES_PROJECT` variable remains `vibeshape-greg` and is not used by this workflow.
No browser upload, additional token, artifact-storage transfer, or CAD kernel build is required.

Before publication, the job requires frozen installation, scoped Biome and typechecks, a production
build, the focused Chromium browser scenarios, the expected personal account, and a source commit that
still matches current `main`. It compares the deployed HTML with the built HTML after upload.
Concurrency serializes presentation deployments. The existing environment allows deployment only
from `main`; the workflow cannot publish this task branch or be initially dispatched until merged.

Use the previous successful production deployment in the `vibeshape-site` Pages dashboard for
rollback. Keep the editor project and relay separate. DNS, TLS, and public-domain verification remain
part of the domain setup handoff.

## Content ownership

- `apps/site/src/messages/en.json` owns typed English copy and introductory articles.
- `apps/site/src/links.ts` owns public destinations and each article's canonical repository reference.
- `apps/site/public/brand` reuses the editor's Benchy wireframe-to-solid brand assets. The hero labels its image as
  an illustration rather than an editor screenshot.
- Documentation uses `#docs/<topic>` links; section links and browser Back work on static hosts.
- The canonical technical documents remain under `docs/`; update introductory copy when those
  contracts change. This site does not expand the CAD or MCP feature contract.

## Static handoff

`bun run build:site` produces `apps/site/dist`. Serve that directory over HTTP(S) on a static host.
Vite uses a relative base so asset URLs also work under a path prefix. Deep documentation links
use fragments and need no server-side route fallback. Copy the complete output, including assets.
If the public origin changes, update the absolute Open Graph image and canonical URLs. The configured presentation origin is
`https://vibeshape.hello-world.cz/`; editor links use `https://cad.hello-world.cz`.
The HTML includes absolute canonical, Open Graph URL, and Open Graph image metadata for the
presentation origin. Domain and Cloudflare hosting setup are managed separately from this source
workspace. The existing editor deployment continues to build `apps/web` separately.


The intended Cloudflare Direct Upload project is `vibeshape-site` in the personal Greg account,
separate from the existing editor project `vibeshape-greg`. Its default hostname is
`vibeshape-site.pages.dev`. Deploy only a verified build and record the source commit and ZIP
checksum with the handoff. Domain and live-deployment readiness must be verified independently.

The existing remote MCP relay still allowlists `https://vibeshape-greg.pages.dev` through its
`EDITOR_ORIGIN` configuration. A new `cad.hello-world.cz` editor hostname does not enable remote MCP
there. The site's MCP guide directs users to the local MCP setup until a separately verified
relay-origin and Turnstile migration is completed. This presentation task does not change or redeploy
the editor or remote MCP relay.
