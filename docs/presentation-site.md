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
Before public deployment, configure absolute Open Graph image and canonical URLs for the selected
site origin. No production website deployment or hosting resource is created by this workspace.
The existing Cloudflare editor deployment continues to build `apps/web` separately.
