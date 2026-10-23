# Isolated Mac CI

VibeShape is public. It has no registered self-hosted Actions runner. All public
workflow jobs run on GitHub-hosted Ubuntu. The retired full-local fallback,
`VIBESHAPE_CI_RUNNER`, and its billing recovery daemon are no longer supported.
Production builds, artifacts, and deployment credentials stay on GitHub. Desktop
release verification also remains fully hosted, independent of the hybrid flag.

## Owner Mac preference and hosted fallback

`VIBESHAPE_CI_HYBRID=true` makes the isolated Mac worker the preferred executor
for complete CI on eligible owner runs. The legacy variable and `hybrid` input
names are retained for callers. The worker runs the dependency audit, Python
policies, skill/format/lint/type checks, remote MCP integration tests, browser
build, Fallow audit, and both complete Node and DOM unit-test corpora. Publication,
production builds, desktop releases, and deployment credentials remain hosted.

Only owner-triggered runs from `kolengri/VibeShape` are eligible. PRs must be
open, owner-authored, from the same repository, and still at the requested head.
Forks and other authors' PRs run entirely on GitHub, including owner-triggered
reruns of contributor PRs. The host broker independently checks this policy using
GitHub API data; public workflow conditions do not grant access to the Mac.

To try a reviewed branch before enabling the repository variable:

```sh
gh workflow run ci.yml --repo kolengri/VibeShape --ref <reviewed-branch> -F hybrid=true
```

The Mac processes one complete request at a time. If no result or heartbeat arrives
for 90 seconds, the hosted waiter requests fallback. The same run then executes
all hosted checks and all three Node shards plus DOM. Infrastructure errors and
the overall 30-minute waiting deadline also request complete hosted verification;
no timeout or missing result counts as success. The broker sends a fresh heartbeat
every 30 seconds while its request remains eligible. Busy, offline, sleeping, or
restarting Macs therefore do not block CI indefinitely.

The pending commit status reports the current Mac stage every 30 seconds. The
`Await isolated Mac CI` step logs observed stage changes with UTC times: VM startup,
source/dependency preparation, checks, build, Node/DOM tests, and cleanup. Short
stages may finish between heartbeats. These labels are advisory and never replace
the final verification result. Older host installations keep their generic
heartbeat until the reviewed controller and golden-image guest helper are updated.

A reported repository verification failure fails CI immediately and does not
trigger fallback. Invalid result identities, canceled/stale requests, and GitHub
API verification errors also fail closed. `Fast PR checks` accepts either complete
Mac success or complete hosted success after an eligible fallback; every other
result combination fails. A passing run may skip hosted checks only after complete Mac
success. Set the flag to `false` for new runs to use hosted execution directly.
A hosted waiter and the aggregate still use standard GitHub runners.

## Private control plane

The private [`kolengri/vibeshape-ci`](https://github.com/kolengri/vibeshape-ci)
repository owns the reviewed, installed host broker and VM executor. Its GitHub
Actions are disabled, and it has no registered runner. The host runs a pinned
installation of that private code; it never loads controller code, commands,
workflow YAML, or configuration from a public checkout.

The broker uses the owner's existing host GitHub CLI login. It passes only an
exact public source SHA and a fixed verification-scope enum to its trusted executor. Neither that credential nor a
GitHub job token enters the worker. The executor downloads a bounded public source
archive and transfers it into the VM without extracting it on macOS. The dependency
phase fetches credential-free Git history from the fixed public repository,
binds HEAD/index to the validated source SHA, and prepares the base for Fallow.
Git parsing and checkout stay inside the guest. Electron is fetched and verified
by its vendor downloader during dependency preparation, so tests need no network.

The result status is bound to the tested checkout SHA and the exact public run ID
and attempt. The waiter accepts the expected owner's status and run URL only.
For a synthetic PR merge, the broker also verifies the current merge ref and its
base/head parents. It revalidates eligibility during execution and before success.
An old head, moved merge, canceled run, interrupted broker, ambiguous job, missing
result, or failed verification cannot satisfy a new attempt. Host state records
execution intent before launch, preventing an interrupted request from silently
being treated as a fresh successful run.

## Worker boundary

Each request receives a fresh Linux VM with its own kernel, cloned from a stopped,
trusted golden image. The worker has six virtual CPUs and 10 GiB RAM on the
16 GiB Mac; the inner test container is limited to six CPUs and 8 GiB. These are
resource limits, not measured optimal allocations. One local worker prevents
concurrent jobs from exhausting host memory.

Tart 2.41.1 launches the VM with clipboard, audio, USB accessories, and graphics
disabled. No macOS directory, additional disk, SSH agent, Docker socket, device,
secret, or host port is shared. Management SSH is initiated by the host with a
dedicated key and forwarding disabled. The guest has only its management public
key. The worker VM and all writable dependency/test state are deleted after each
attempt; failed cleanup prevents the next worker from starting.

Softnet 0.24.1 enforces network filtering outside the guest. Guest-initiated traffic
to the VM gateway and all connected host IPv4 networks is denied. A default-deny
policy permits only host-resolved addresses for the npm registry and the
allowlisted structural-asset hosts, GitHub Git and release-asset endpoints, plus
two fixed public
DNS resolvers; private/reserved IPv4 and IPv6 remain denied. A registry or
DNS address overlapping a connected host network aborts startup. Host-initiated
management connections can receive replies. The test container itself uses
`--network=none`. Dependencies requiring other download hosts fail closed.
A guest-root compromise cannot remove the external filter.

Inside the VM, source extraction and dependency lifecycle scripts run as a
non-root container user. The container has a read-only root filesystem, no Linux
capabilities, no privilege escalation, and bounded memory, processes, temporary
storage, output, and execution time. The test container runs complete Node and DOM
corpora offline. Legacy shard requests remain supported during controller upgrades,
using the same committed timings as the hosted shards. It cannot publish production artifacts or reusable test receipts.

## Host operation and remaining limits

Installation and image preparation are documented in the private control
repository. Softnet requires a one-time macOS administrator confirmation for its
verified root-owned helper. The broker receives no general passwordless sudo.
Install or update the controller only from a reviewed private commit. Do not
re-register the old public runner or re-enable `dev.vibeshape.actions-fallback`.

Only the owner currently has repository write access. External contributors'
workflow runs require approval. These controls limit who can request work, while
the VM and external network filter provide the machine boundary. Workflow files
can still be changed in a PR; a publicly registered runner would therefore defeat
the intended isolation even if its normal workflow had restrictive conditions.
The waiter is also editable source: the required aggregate alone does not prove
that a maliciously rewritten workflow ran every intended test. Review workflow
changes before merging them.

Drain workers before changing host networks; connected network ranges are captured at VM startup.
Keep the Mac powered, connected, and awake on AC power. The broker is a login
service; reboot/FileVault unlock requires login before it starts. No software
boundary removes hypervisor, networking-helper, or SSH implementation risk.
Keep macOS, the golden image, and the reviewed runtime updated, and rerun the
host/LAN denial and cancellation checks after changing this boundary.
