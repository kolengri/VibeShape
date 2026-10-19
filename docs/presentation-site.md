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

## Scroll-driven hero

The hero uses a silent six-second H.264 visual in `apps/site/public/media`. Scrolling seeks the
paused video forward or backward; it does not autoplay. On desktop viewports at least 1024 pixels
wide and 800 pixels tall, the hero stays visible during this transition. Smaller viewports use normal
document flow. Reduced-motion preferences show the poster without loading video, and media errors
also leave the poster visible. Text and branding belong to the page, not the visual.

The original 3DBenchy mesh is CC0; its source and attribution are in `media/NOTICE.txt`. The remaining
geometry is a presentation illustration, not an editor recording. Every video frame is independently
seekable, and the site loads no Three.js or CAD runtime for this animation.

## Spatial illustrations

The printer illustration takes 2.4 seconds per layer, revealing all 17 layers over 40.8 seconds.
The head then lifts and parks over 2.4 seconds, completing the cycle in 43.2 seconds.
It stays finished when revisited. Feature diagrams, workflow stages, and agent steps animate once
when their block enters the viewport; selecting another workflow stage starts that stage's visual.
Reduced-motion preferences show completed static illustrations and keep all content visible.
These SVG/CSS illustrations use the existing theme tokens and do not load the CAD runtime.

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
- `apps/site/public/brand` reuses the editor's existing brand assets. The hero labels its image as
  an illustration rather than an editor screenshot.
- Documentation uses `#docs/<topic>` links; section links and browser Back work on static hosts.
- The canonical technical documents remain under `docs/`; update introductory copy when those
  contracts change. This site does not expand the CAD or MCP feature contract.

## Downloads and release maintenance

As verified on October 19, 2026, the public GitHub release contains an OCCT corresponding-source
archive, not VibeShape desktop installers. The site states that installers are not published and
links to source installation, portable package preparation, and the release index. It must not
present the OCCT archive as an application download or claim Windows installer availability.

When application installers are published, update the availability text and date, add the verified
platform/architecture asset links to `links.ts`, and update the download browser test. Keep build
instructions distinct from ready-to-run downloads. The site does not fetch GitHub on visitor load.

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
