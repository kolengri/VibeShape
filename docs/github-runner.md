# Personal GitHub Actions fallback

VibeShape normally uses GitHub-hosted Ubuntu runners. Setting the repository variable
`VIBESHAPE_CI_RUNNER` to `mac` routes CI and every Cloudflare job to the repository-scoped
`vibeshape-mac` runner (`self-hosted`, `Linux`, `ARM64`). Any other value uses
GitHub-hosted runners unless hybrid CI is explicitly enabled below.
All verification steps, publication environments, credentials,
protected-head checks, and deployment concurrency remain in effect.

## Hybrid CI

Set `VIBESHAPE_CI_HYBRID=true` while `VIBESHAPE_CI_RUNNER` is `github` (or unset)
to distribute CI across hosted runners and the dedicated Mac. The three Node
shards remain complementary: `1/3` and `2/3` run on GitHub, and `3/3` runs on the
Mac. DOM tests, static/integration checks, the aggregate, and Cloudflare publication
jobs remain hosted. The committed timing profile balances the native shards;
`3/3` was the slowest hosted shard in the first sharded PR run, but future timing
and cross-architecture performance can vary. Every shard remains required and
partial runs never read or write complete-workspace receipts.

Only the same trusted repository/PRs eligible for full Mac fallback can use the
Mac in hybrid mode. Fork and non-owner PRs execute all three shards on GitHub.
Full `VIBESHAPE_CI_RUNNER=mac` fallback takes precedence over the hybrid flag.
The existing billing controller can temporarily select full Mac fallback and
restore hosted routing at the next billing month; the separate hybrid flag is
preserved, so mixed execution resumes without changing the controller.

The runner must be online. An offline Mac or a local queue delays its shard;
GitHub does not automatically move it to a hosted runner. Disable the hybrid flag
and start a new run to use hosted execution again. Changing variables does not
move already queued jobs. Keep one runner on this 16 GiB Mac so concurrent local
jobs cannot each claim all eight test workers and exhaust memory.

To test a reviewed branch without changing repository variables, dispatch only
the CI workflow with its boolean `hybrid` input:

```sh
gh workflow run ci.yml --repo kolengri/VibeShape --ref <reviewed-branch> -F hybrid=true
```

## Mac runtime

The runner uses the official GitHub runner image, pinned by version and digest, with `gh`,
Python, build tools, and Node.js 24/npm added. OrbStack runs the Linux ARM64 container on Apple Silicon.
New containers have no CPU or memory cap, a 1 GiB shared-memory area, and their own named
workspace volume. No macOS home directory or Docker socket is mounted, and no ports are
published. Dependency installation and browser downloads happen inside Linux. A GitHub pre-job
hook clears the exact repository workspace, including hidden files, before every job; runner
actions/tool/browser caches remain outside it. Publication jobs start without a stale checkout,
lockfile, dependencies, or older downloaded artifacts. Unexpected/symlinked workspace paths fail
the job instead of being deleted.

CI selects the native test worker count from the CPUs available to each job.
OrbStack's global resource limits still apply. On the current eight-core, 16 GiB
Mac, CPU access is eight cores and the OrbStack memory ceiling is 16 GiB. Memory is allocated
on demand, rather than reserved. The installer removes a previous CPU quota and raises an
existing container's memory ceiling to the full OrbStack memory pool;
OrbStack settings can be adjusted with `orb config set cpu 8` and
`orb config set memory_mib 16384` on this host.

Only this private repository is registered. Owner-authored PRs whose source is the same
repository can use the fallback; fork and other authors' PRs retain GitHub-hosted routing.
This persistent runner is intended for trusted personal code. Do not register public or
untrusted projects on it. Workflow code has access to this repository's persistent Linux
workspace and to credentials granted to its current job, including production credentials
when GitHub authorizes a production environment.

Install from a reviewed checkout on an Apple Silicon Mac with OrbStack, Docker CLI, and
an authenticated GitHub CLI account that administers this repository:

```sh
bash ops/github-runner/install-macos.sh
```

Start OrbStack before the initial installation if its daemon is not yet ready. Registration
uses a short-lived token piped directly into the container. The host GitHub CLI login is
never mounted or copied into the runner. Runner registration credentials remain inside the
container; GitHub's automatic runner updates are enabled. Recreating the container requires
removing the old registration and registering again; replacing an active runner is not part
of the installer.

The installer copies the controller into
`~/Library/Application Support/GitHubRunners/vibeshape/` and installs the LaunchAgent
`dev.vibeshape.actions-fallback`. It starts OrbStack and checks every three minutes, also at
login. Docker's restart policy restarts the container after the Linux runtime restarts.
Re-run the installer to update the copied controller after reviewing changes. Restore hosted
routing and wait for the local runner to be idle first; the installer rejects a busy runner and
restarts an existing idle listener so its pre-job hook configuration takes effect.

Keep the Mac connected to power and the network, with sleep disabled on AC power. This is
a login service: after a reboot/FileVault unlock, the macOS user must log in before it starts.
A closed laptop lid can suspend the Mac; use a supported awake/clamshell setup. A powered-off,
sleeping, or disconnected Mac cannot run jobs. Self-hosted Actions execution does not consume
GitHub-hosted minutes; GitHub artifact storage is still governed by the account's limits.

## Automatic recovery

GitHub does not automatically substitute a self-hosted runner when hosted minutes run out.
The host-side controller uses the existing `gh` login to inspect workflow runs and check-run
annotations; it needs no additional billing OAuth scope or credential inside CI.

It redirects only when GitHub reports an **unstarted** failed job with an annotation about
a spending/minutes limit. A failed test, build, asset check, missing runner, or permission
error does not activate recovery. The same GitHub billing message can also mention failed
payments; recovery is based on that scheduling message, not a measurement of remaining minutes.
The account's budgets and payment settings are never changed.

Before switching, the controller checks that the local runner is online. It retries failed
jobs only for the current main SHA or an open, current, owner-authored, same-repository
PR. Both workflow files must contain the selector at the run's API `head_sha`. For PRs this is
the source-branch head, not the original synthetic merge SHA used by GitHub. As a conservative
rollout requirement, older PR branches must merge/rebase `main` first, even if their merge result
inherits the selector. The controller does not guess the original workflow from a newer merge ref.
Earlier workflow versions cannot gain routing by rerunning; superseded commits and runs predating
installation are ignored. Only `ci.yml` and `cloudflare-pages.yml` are eligible. The last 100 failed runs
are inspected per poll; this is intended for personal-project volume, not an organization queue.

After automatic recovery, subsequent jobs use the Mac. On the first poll of a new UTC month,
the controller restores GitHub-hosted routing and stops retrying the preceding month's runs.
It requests at most one successful automatic retry per run, even if the retry is also blocked.
API failures retain retry state.
A manually selected `mac` mode has no automatic monthly reset. There is no automatic hosted
fallback while the Mac is offline; jobs already queued for it keep their original labels.

## Operation

```sh
# Force local execution or restore hosted execution.
gh variable set VIBESHAPE_CI_RUNNER --repo kolengri/VibeShape --body mac
gh variable set VIBESHAPE_CI_RUNNER --repo kolengri/VibeShape --body github

# Opt into mixed CI, or return to fully hosted CI when the primary mode is github.
gh variable set VIBESHAPE_CI_HYBRID --repo kolengri/VibeShape --body true
gh variable set VIBESHAPE_CI_HYBRID --repo kolengri/VibeShape --body false

# Inspect Linux runtime, registration, and controller errors.
docker logs --tail 30 vibeshape-actions-runner
gh api repos/kolengri/VibeShape/actions/runners
tail -n 30 "$HOME/Library/Application Support/GitHubRunners/vibeshape/fallback-error.log"

# Stop automatic recovery and the local runner.
launchctl bootout "gui/$(id -u)/dev.vibeshape.actions-fallback"
docker stop vibeshape-actions-runner
```

Restore the variable to `github` before stopping if hosted execution is desired. To keep
recovery stopped after the next login, remove its LaunchAgent plist. Do not prune unrelated
Docker data. Workspace/browser caches occupy disk; inspect the named volume and available
Mac disk space before adding more projects.

Controller checks:

```sh
python3 -m unittest discover -s ops/github-runner -p 'test_*.py'
python3 ops/github-runner/fallback.py --state /tmp/vibeshape-fallback-dry-run.json --dry-run
```

The CI workflow also accepts `workflow_dispatch` for verifying a branch without publishing
to Cloudflare. A green local CI run verifies the selected checks on Linux ARM64; it does not
prove a production deployment or a real billing-limit event. See [Cloudflare deployment](cloudflare-deployment.md)
for publication gates.
