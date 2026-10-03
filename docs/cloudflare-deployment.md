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
4. Stage only static web assets and complete corresponding sources. Files over the Pages limit are
   rejected, except corresponding-source archives, which are split into reconstructable 20 MiB
   parts. `sources/RECONSTRUCT.txt` records the exact filenames and whole-archive SHA-256. The
   application source TAR is included; no project files or local server executable are uploaded.
5. Pass an immutable, one-day Actions artifact to the separate publication job. That job installs
   no project dependencies, checks every asset hash and size against the build's manifest digest,
   rejects symlinks, confirms the source is still the current protected `main`, and publishes with
   pinned Wrangler 4.136.3. Production publication is serialized and never cancelled mid-deploy.

The `cloudflare-production` GitHub environment owns publication credentials. Restrict it to `main`
and configure an approval gate for initial activation. PRs and fork code never receive the token.
No `pull_request_target`, broad write permission, GitHub-to-Cloudflare app grant, or global token is
used. The workflow records commit, site-manifest digest and Cloudflare deployment URL in its summary;
the same source identity and per-file hashes are published as `/site-manifest.json`.

## One-time setup requiring the owner's decision

Read-only inspection on 2026-10-03 found a public `kolengri/VibeShape` repository, protected `main`,
and no Actions secrets, variables, environments or Releases. No Cloudflare account/project has been
selected or verified in this task. These steps have not been performed:

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
No credentials, access grants, Releases, Pages projects or paid resources were created by preparing
these files. Missing setup fails closed; an absent enable variable leaves the workflow skipped.

## Headers and browser acceptance

`deployment/cloudflare/_headers` preserves strict document CSP and allows the pinned binding's
dynamic JavaScript only on the hashed worker-entry response. Its CSP patterns do not overlap:
Cloudflare joins duplicate header values, so adding a second CSP cannot relax a broader policy.
The config supplies WASM MIME, same-origin resource policy, immutable hashed assets and revalidation
for HTML/service-worker files. No COOP/COEP or SharedArrayBuffer is needed. A top-level `404.html`
prevents Pages' SPA fallback from returning HTML for missing assets or nonexistent APIs.

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

## Official references

- [Direct Upload CI and minimum Pages token permission](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
- [Pages asset and header limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Header rules and duplicate handling](https://developers.cloudflare.com/pages/configuration/headers/)
- [404 and SPA behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Official Wrangler action and version pinning](https://github.com/cloudflare/wrangler-action)
