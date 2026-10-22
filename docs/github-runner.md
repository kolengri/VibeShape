# Isolated Mac CI

VibeShape is public. It has no registered self-hosted Actions runner. All public
workflow jobs run on GitHub-hosted Ubuntu. The retired full-local fallback,
`VIBESHAPE_CI_RUNNER`, and its billing recovery daemon are no longer supported.
Production builds, artifacts, and deployment credentials stay on GitHub. Desktop
release verification also remains fully hosted, independent of the hybrid flag.

## Hybrid execution

`VIBESHAPE_CI_HYBRID=true` requests Node shard `3/3` from the isolated Mac worker.
Node shards `1/3` and `2/3`, DOM, static/integration checks, and the required
`Fast PR checks` aggregate remain hosted. Every shard is required. Partial runs
never restore or save complete-workspace receipts. A hosted waiter verifies the
Mac result, so this arrangement still consumes hosted waiting time.

Only owner-triggered runs from `kolengri/VibeShape` are eligible. PRs must be
open, owner-authored, from the same repository, and still at the requested head.
Forks and other authors' PRs run entirely on GitHub. The host broker independently
checks this policy using GitHub API data; public workflow conditions do not grant
access to the Mac.

To try a reviewed branch before enabling the repository variable:

```sh
gh workflow run ci.yml --repo kolengri/VibeShape --ref <reviewed-branch> -F hybrid=true
```

The Mac processes one shard at a time. An offline, sleeping, or busy Mac delays its
waiter; missing or failed results fail closed after the waiting deadline. GitHub
does not automatically reschedule that job on another runner. Disable the flag
and start a new run to restore fully hosted execution. Changing a variable does
not move an already running job.

## Private control plane

The private [`kolengri/vibeshape-ci`](https://github.com/kolengri/vibeshape-ci)
repository owns the reviewed, installed host broker and VM executor. Its GitHub
Actions are disabled, and it has no registered runner. The host runs a pinned
installation of that private code; it never loads controller code, commands,
workflow YAML, or configuration from a public checkout.

The broker uses the owner's existing host GitHub CLI login. It passes only an
exact public source SHA to its trusted executor. Neither that credential nor a
GitHub job token enters the worker. The executor downloads a bounded public source
archive and transfers it into the VM without extracting it on macOS.

The result status is bound to the tested checkout SHA and the exact public run ID
and attempt. The waiter accepts the expected owner's status and run URL only.
For a synthetic PR merge, the broker also verifies the current merge ref and its
base/head parents. It revalidates eligibility during execution and before success.
An old head, moved merge, canceled run, interrupted broker, ambiguous job, missing
result, or failed verification cannot satisfy a new attempt. Host state records
execution intent before launch, preventing an interrupted request from silently
being treated as a fresh successful run.

## Worker boundary

Each shard receives a fresh Linux VM with its own kernel, cloned from a stopped,
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
policy permits only the npm registry addresses resolved by the host and two fixed
public DNS resolvers; private/reserved IPv4 and IPv6 remain denied. A registry or
DNS address overlapping a connected host network aborts startup. Host-initiated
management connections can receive replies. The test container itself uses
`--network=none`. Dependencies requiring other download hosts fail closed.
A guest-root compromise cannot remove the external filter.

Inside the VM, source extraction and dependency lifecycle scripts run as a
non-root container user. The container has a read-only root filesystem, no Linux
capabilities, no privilege escalation, and bounded memory, processes, temporary
storage, output, and execution time. The test container runs the complete Node
corpus with Bun's native `--shard=3/3`, using the same committed timings as the
hosted shards. It cannot publish production artifacts or reusable test receipts.

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
