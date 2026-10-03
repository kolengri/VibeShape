# Cloudflare static deployment

The hosted stage serves manual CAD as static HTTPS files. Geometry and solving remain in browser
workers; projects remain in browser storage or downloaded `.vshape` files. A new hostname has a
separate storage origin. The local MCP server is excluded. Remote MCP authentication and a browser
session relay are a separate implementation; this workflow does not advertise them as working.

## Pipeline

`.github/workflows/ci.yml` verifies PRs to `main` and can be called by the production workflow.
`.github/workflows/cloudflare-pages.yml` runs only for this repository's `main`, after
`VIBESHAPE_CLOUDFLARE_ENABLED` is explicitly set to `true`. Its sequence is:

1. Run the existing audit, formatting, lint, types, tests, build and Fallow gates without Cloudflare
   credentials. Official actions are pinned to reviewed commit SHAs.
2. Confirm `main` is protected. Fetch one repository release asset containing the already verified
   OCCT corresponding-source TAR. Check its hardcoded SHA-256 before extraction. Verify the bundle
   and solver, then build the application with the controlled kernel. Native kernels are not built
   in Actions.
3. Package the exact commit and exercise its real Chromium save/restart/native recovery/MCP flow.
4. Generate complete license texts for the exact browser and worker bundles, retain copied UI
   licensing, and stage only static web assets and complete corresponding sources. Files over the Pages limit are
   rejected, except corresponding-source archives, which are split into reconstructable 20 MiB
   parts. `sources/RECONSTRUCT.txt` records the exact filenames and whole-archive SHA-256. The
   application source TAR is included; no project files or local server executable are uploaded.
5. Pass an immutable, one-day Actions artifact to the separate publication job. That job installs
   no project dependencies, checks every asset hash and size against the build's manifest digest,
   rejects symlinks, confirms the source is still the current protected `main`, and publishes with
   pinned Wrangler 4.136.3. Production publication is serialized and never cancelled mid-deploy.

When `VIBESHAPE_REMOTE_MCP_URL` is configured, the same verified build also creates a bundled relay
artifact with an exact source/hash manifest. A separate `cloudflare-mcp-production` job checks its
account, Worker name, origin and current protected `main`, then publishes with Wrangler 4.147.0
before the editor. Neither publication job installs project dependencies. Relay failure blocks the
new editor deployment; an empty relay URL preserves the static-only path. PRs receive no deployment
credentials. Configure the separately approved Worker token before activating this workflow version.
The entire production workflow shares a non-cancelling concurrency group, so a newer run cannot
publish its Worker while an older run is still publishing its editor.

The `cloudflare-production` GitHub environment owns publication credentials. Restrict it to `main`
and obtain the owner's approval before initial activation. PRs and fork code never receive the token.
No `pull_request_target`, broad write permission, GitHub-to-Cloudflare app grant, or global token is
used. The workflow records commit, site-manifest digest and Cloudflare deployment URL in its summary;
the same source identity and per-file hashes are published as `/site-manifest.json`.

## One-time setup requiring the owner's decision

Provisioning on 2026-10-03 selected the personal **Greg** account
(`dddb9fcdf9bec709036b951ebb932642`), verified through OAuth as `kolenko@me.com`.
The Direct Upload Pages project is `vibeshape-greg`, with production branch `main` and hostname
`https://vibeshape-greg.pages.dev`. Creating the project does not prove a working public editor.
The `cloudflare-production` environment is restricted to `main`; its Pages-only
`CLOUDFLARE_API_TOKEN` secret was entered privately by the owner and its presence verified.
The account/project environment variables and controlled-source repository asset variable are set.
The controlled TAR is stored as asset `607712548` in release `cloudflare-occt-0c007be`.
On 2026-10-03 the owner explicitly authorized the first personal hosted release after technical
checks, deferring the separate legal review required by `docs/licensing.md`. This is a scoped
release decision, not a legal certification or a waiver of license/source obligations.
Publication was enabled and the automatic `main` run
[37124957395](https://github.com/kolengri/VibeShape/actions/runs/37124957395) published commit
`6d1017c0af0d9e586f17cdde6efdace139675613`. Its public Chromium, Firefox and WebKit acceptance
passed creation/editing, native save/open, STEP/STL/3MF exports, worker/WASM loading and missing-route
checks. No paid upgrade, Dealyv deployment, or Heyfoods credential change was performed.

For another account or re-provisioning, use the following setup contract:

1. Choose the intended Cloudflare account and an existing Pages project, or authorize creating one
   Direct Upload project with production branch `main`. Confirm its hostname and public access to
   the application and corresponding sources. Configure no paid upgrade. Review the repository's
   [public distribution licensing gates](licensing.md) before enabling publication.
2. After explicit authorization, create an API token with **Account → Cloudflare Pages → Edit**,
   restricted to that account. Do not use a Global API Key, unrelated project token or broader
   Workers/DNS permissions. Cloudflare's Pages permission is account-scoped; if that account holds
   other Pages projects, it grants account-level Pages editing, not a verified project-only scope.
   Store it directly in GitHub environment `cloudflare-production` as secret
   `CLOUDFLARE_API_TOKEN`; do not paste it into source, logs or chat.
3. Set environment variables `CLOUDFLARE_ACCOUNT_ID` (the account's 32-character ID) and
   `CLOUDFLARE_PAGES_PROJECT` (the existing project's name). Restrict environment deployment
   branches to `main`. Preserve existing branch protection and require the PR verification gate.
4. After approving the source publication, upload the exact controlled TAR as a release asset in
   this repository, then set repository variable `VIBESHAPE_OCCT_RELEASE_ASSET_ID` to its numeric
   asset ID. The already prepared file is the local package's
   `apps/web/dist/sources/occt-corresponding-source.tar`, SHA-256
   `965e89b6b7afd1401e7ed34b0ac89157b78e5c3c76d897a2f503fc56523a70c0`.
   The pipeline refuses other bytes; a kernel update requires a separately reviewed checksum change.
5. Confirm the account's free quotas and GitHub artifact budget, then set repository variable
   `VIBESHAPE_CLOUDFLARE_ENABLED=true`. The pipeline uses one-day artifact retention and does not
   enable billing. Merge through the protected branch or dispatch the workflow on `main`.

Enabling this pipeline authorizes subsequent protected `main` deployments under the configured
environment policy. It does not authorize changing another project's credentials or deployment.
The configuration itself creates no credentials or resources. Missing setup fails closed; an absent enable variable leaves the workflow skipped.

## Headers and browser acceptance

`deployment/cloudflare/_headers` preserves strict document CSP and allows the pinned binding's
dynamic JavaScript only on the hashed worker-entry response. Its CSP patterns do not overlap:
Cloudflare joins duplicate header values, so adding a second CSP cannot relax a broader policy.
The config supplies WASM MIME, same-origin resource policy, immutable hashed assets and revalidation
for HTML/service-worker files. No COOP/COEP or SharedArrayBuffer is needed. A top-level `404.html`
prevents Pages' SPA fallback from returning HTML for missing assets or nonexistent APIs.

When a reviewed remote relay is enabled, set repository variable `VIBESHAPE_REMOTE_MCP_URL`.
The existing workflow supplies it as `VITE_REMOTE_MCP_URL` consistently for the build and staging
commands. Staging accepts only an HTTPS `/mcp` endpoint, adds its exact HTTPS/WSS origin
and Cloudflare Turnstile script/frame origin to editor-document CSP, and leaves geometry-worker
and source-document policies unchanged. A static-only build does not enable this allowance.
See [license notice provenance](../deployment/licenses/README.md) for embedded dependency handling.

The relay publication token is separate from the Pages token. After explicit owner approval, create
**Account → Workers Scripts → Edit** for the personal Greg account only and store it directly as
`CLOUDFLARE_MCP_API_TOKEN` in the `cloudflare-mcp-production` GitHub environment. Restrict that
environment to `main`. The account-scoped permission can edit other Workers in that account; it is
not a verified per-Worker scope. The pipeline does not provision namespaces, widgets, secrets,
routes or subscriptions, so the token needs no Workers KV, Turnstile, DNS or billing permissions.
The already provisioned `TURNSTILE_SECRET_KEY` stays in Cloudflare; deployments preserve secrets.

Before declaring the first hosted deployment usable, check actual response headers, worker/WASM
startup and a create/edit/save/reload/export journey in Chromium, Firefox and WebKit; verify a
missing asset and automation API return 404; reconstruct a source archive and check its digest.
The configuration and local staging checks do not prove a live Cloudflare deployment. The current
application does not claim a complete installable/offline PWA update lifecycle.

## Rollback

Record the deployment URL and source commit from each successful run. In the Cloudflare Pages
dashboard, select the prior successful production deployment and use its rollback action. This
changes served application files, not browser documents or schema versions. Keep `.vshape` backups.
Reverting through protected `main` creates a new fully gated deployment; running an old workflow
against a non-current commit intentionally fails the current-head check. Preserve the approved
kernel asset while a supported version needs it.

For a relay-enabled release, also restore the matching Worker version through its Cloudflare
deployment history. Preserve the current bindings, OAuth KV and SQLite objects. Rolling back code
does not reverse storage migrations or an already accepted browser save; review compatibility before
rolling back future protocol or storage changes.

## Official references

- [Direct Upload CI and minimum Pages token permission](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
- [Pages asset and header limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Header rules and duplicate handling](https://developers.cloudflare.com/pages/configuration/headers/)
- [404 and SPA behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Official Wrangler action and version pinning](https://github.com/cloudflare/wrangler-action)
