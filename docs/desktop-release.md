# Automated desktop releases

The **Desktop release** GitHub Actions workflow builds and publishes the existing Apple Silicon
DMG and Windows x64 portable ZIP in one manual run. It uses the current delivery policy documented
in [macOS desktop delivery](desktop-macos.md#release-checks-and-downloads) and
[Windows desktop delivery](desktop-windows.md#verification-and-release-limits): macOS is ad-hoc
signed and not notarized; Windows is unsigned. It does not add Developer ID or Authenticode signing.

## Run a release

1. Merge the desired application changes into `main`.
2. Open **Actions → Desktop release → Run workflow**, select `main`, and run it.
3. Wait for the full workflow to succeed. The run summary links the published release and website.

No version edit or release PR is required. The workflow chooses the next patch after the highest
existing stable `desktop-vMAJOR.MINOR.PATCH` tag or release, including drafts without a tag.
The version in `apps/desktop/package.json` is a
minimum: a deliberately prepared newer minor or major version is used if it is not already taken.
For example, source version `0.1.13` with tag `desktop-v0.1.13` produces `0.1.14`; another run produces
`0.1.15` even if the version on `main` still reads `0.1.13`.

The workflow creates a release commit containing only the selected desktop version in
`apps/desktop/package.json` and `bun.lock`, with the dispatched commit as its sole parent. It pushes
an annotated `desktop-vVERSION` tag recording the workflow run ID and both source SHAs. It never
pushes commits to `main`. CI, Windows source checks, the website build and desktop packaging check
out the generated release commit; receipts and bundled application sources identify that exact
commit. The native
acceptance harness remains the dispatched source, while its expected artifact SHA is the release
commit. The tag and its source are reserved before CI and packaging; public downloads appear only
after both native acceptance jobs and publication succeed.
Only `kolengri/VibeShape` on `main` can execute this workflow. Its initial preflight rejects a
dispatch whose source has already been superseded on `main`.

## Build and acceptance

The workflow runs the existing reusable CI checks, Windows native source checks, and the
presentation site's production-build tests, including desktop download discovery. Windows source
checks run here before packaging and can also be dispatched manually; they do not run on every
pull request. A failed Windows source check blocks packaging and publication. The workflow downloads
the configured OCCT corresponding-source archive, verifies the same pinned SHA-256 used by the
browser deployment, and invokes the existing
source-matched desktop packager on Apple Silicon. Both packages contain the controlled editor,
kernel and solver, exact corresponding sources, notices and replacement instructions.

The six release assets are:

- `VibeShape-VERSION-mac-arm64.dmg`, `desktop-build.json`, and `SHA256SUMS`;
- `VibeShape-VERSION-win-x64.zip`, `desktop-build-win-x64.json`, and `SHA256SUMS-win-x64`.

The draft is tested through the reusable **macOS release validation** and **Windows release
validation** workflows on separate native runners. These download the actual uploaded archives,
verify their receipts and independently recorded checksums, then exercise the packaged application.
macOS acceptance also checks the DMG, application signature and architecture. Publication requires
both platforms to pass and every uploaded asset's GitHub SHA-256 to match its original build hash.

This does not establish Gatekeeper acceptance, notarization, Authenticode authentication, Intel Mac
support or Windows ARM64 support. It does not replace the repository's other release compliance
obligations or local-only evidence workflows.

## Website downloads

The live [presentation website](https://vibeshape.hello-world.cz) reads public stable GitHub Releases
on page load. Publishing the validated draft exposes both installers there and through desktop
update checks. Reload an already open page to discover the new release. No Cloudflare deployment,
Cloudflare token or second workflow launch is needed for new download links. GitHub API outages
or rate limits can delay discovery; the website retains its link to the release listing.

The separate `Presentation website` workflow still deploys website source changes from `main`;
`Cloudflare Pages` still owns deployment of the browser editor and remote MCP service. Releasing
desktop applications does not redeploy those services.

## Configuration and failures

`VIBESHAPE_OCCT_RELEASE_ASSET_ID` must identify the verified OCCT archive in this repository.
The existing repository variable is reused. GitHub's built-in `GITHUB_TOKEN` supplies job-scoped
tag and release access; no personal access token or new signing secret is required. Repository
rules must allow this token to create `desktop-v*` tags; it does not require permission to push
`main`. Hosted macOS and
Windows runner availability and the repository's Actions budget remain prerequisites.

If verification or packaging fails, the reserved tag remains; a draft exists only if packaging
reached the upload stage. If native acceptance fails, the release stays a draft. Neither case
becomes a website download or update. A new dispatch chooses the next available patch, so failed
runs can leave gaps in version numbers. Tags and published releases are never overwritten.

Use **Re-run failed jobs** for transient failures: completed build outputs and the draft remain the
acceptance inputs. A full rerun of the same workflow run reuses its annotated tag, version and
source commit instead of allocating another version, provided its dispatched source is still
current `main`. It can rebuild and replace assets only in a draft belonging to that release commit,
then repeats both acceptance workflows. Do not manually publish a failed draft or replace its
assets after acceptance. For a source fix, merge the change and start a new dispatch; version
selection is automatic. A reservation belonging to another source or run is never reused.
Rerunning only the build after publication also refuses to replace the public assets: staging
rechecks draft status, source and any existing tag immediately before upload.
Draft notes contain a hidden run/source marker; staging refuses foreign or manually created drafts
and notes with that marker removed, even when their tag names match.
Publication also refuses a late retry when a newer stable desktop version is already public,
preserving the website and update channel's release order.

The standalone validation workflows remain available for inspecting an existing draft. They do
not publish it. This workflow has a single serialized release lane and never cancels an active
release to start another one.
