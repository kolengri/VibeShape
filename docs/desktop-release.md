# Automated desktop releases

The **Desktop release** GitHub Actions workflow builds and publishes the existing Apple Silicon
DMG and Windows x64 portable ZIP in one manual run. It uses the current delivery policy documented
in [macOS desktop delivery](desktop-macos.md#release-checks-and-downloads) and
[Windows desktop delivery](desktop-windows.md#verification-and-release-limits): macOS is ad-hoc
signed and not notarized; Windows is unsigned. It does not add Developer ID or Authenticode signing.

## Run a release

1. Merge the desired changes into `main`, including a new stable SemVer in
   `apps/desktop/package.json`. An already published version cannot be overwritten.
2. Open **Actions → Desktop release → Run workflow**, select `main`, and run it.
3. Wait for the full workflow to succeed. The run summary links the published release and website.

The tag is `desktop-vVERSION`. The workflow does not change source versions or push commits to
`main`; all packages, receipts and bundled application sources use the exact dispatched commit.
Only `kolengri/VibeShape` on `main` can execute this workflow. Its initial preflight rejects a
dispatch whose source has already been superseded on `main`.

## Build and acceptance

The workflow runs the existing reusable CI checks and the presentation site's production-build
tests, including desktop download discovery. It downloads the configured OCCT corresponding-source
archive, verifies the same pinned SHA-256 used by the browser deployment, and invokes the existing
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
release access; no personal access token or new signing secret is required. Hosted macOS and
Windows runner availability and the repository's Actions budget remain prerequisites.

If acceptance fails, the release stays a draft and does not become a website download or update.
Use **Re-run failed jobs** for transient failures: completed build outputs and the draft remain the
acceptance inputs. A full rerun can rebuild and replace assets only in a draft belonging to the
same commit, then repeats both acceptance workflows. Do not manually publish a failed draft or
replace its assets after acceptance. For a source fix, merge a new commit and use a new version;
a draft or tag belonging to another commit is deliberately rejected.
Rerunning only the build after publication also refuses to replace the public assets: staging
rechecks draft status, source and any existing tag immediately before upload.

The standalone validation workflows remain available for inspecting an existing draft. They do
not publish it. This workflow has a single serialized release lane and never cancels an active
release to start another one.
