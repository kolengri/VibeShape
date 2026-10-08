#!/bin/bash
set -euo pipefail

directory="$(cd "$(dirname "$0")" && pwd)"
repository=kolengri/VibeShape
container=vibeshape-actions-runner
runner=vibeshape-mac
service=dev.vibeshape.actions-fallback
runtime="$HOME/Library/Application Support/GitHubRunners/vibeshape"
agent="$HOME/Library/LaunchAgents/$service.plist"
gh_path="$(command -v gh)"
docker_path="$(command -v docker)"

test "$(uname -m)" = arm64
open -gj -a OrbStack
"$docker_path" info >/dev/null
"$gh_path" api "repos/$repository" --jq '.private and .permissions.admin' | /usr/bin/grep -qx true
"$docker_path" build -t vibeshape-actions-runner:2.338.0 "$directory"

if ! "$docker_path" container inspect "$container" >/dev/null 2>&1; then
    "$docker_path" run -d --name "$container" --init --restart unless-stopped \
        --cpus 4 --memory 6g --memory-swap 6g --pids-limit 1024 --shm-size 1g \
        --mount type=volume,source=vibeshape-actions-work,target=/home/runner/_work \
        vibeshape-actions-runner:2.338.0 \
        bash -c 'while [ ! -f .runner ]; do sleep 2; done; exec ./run.sh'
fi
"$docker_path" start "$container" >/dev/null
if ! "$docker_path" exec "$container" test -f /home/runner/.runner; then
    # Pipe the short-lived token directly; do not persist it in Docker environment/config.
    "$gh_path" api --method POST "repos/$repository/actions/runners/registration-token" --jq .token |
        "$docker_path" exec -i "$container" bash -c '
            read -r registration_token
            ./config.sh --unattended --url https://github.com/kolengri/VibeShape \
                --token "$registration_token" --name vibeshape-mac \
                --labels vibeshape-mac --work _work >/dev/null
        '
fi

umask 077
mkdir -p "$runtime" "$HOME/Library/LaunchAgents"
cp "$directory/fallback.py" "$runtime/fallback.py"
"$gh_path" variable list --repo "$repository" --json name --jq '.[].name' > "$runtime/variables.txt"
if ! /usr/bin/grep -qx VIBESHAPE_CI_RUNNER "$runtime/variables.txt"; then
    "$gh_path" variable set VIBESHAPE_CI_RUNNER --repo "$repository" --body github
fi
rm "$runtime/variables.txt"
/usr/bin/python3 - "$runtime" "$agent" "$gh_path" "$docker_path" <<'PY'
import pathlib, plistlib, shlex, sys
runtime, agent, gh, docker = sys.argv[1:]
command = ["/usr/bin/python3", str(pathlib.Path(runtime) / "fallback.py"),
           "--state", str(pathlib.Path(runtime) / "state.json"), "--gh", gh, "--docker", docker]
launcher = pathlib.Path(runtime) / "poll.sh"
launcher.write_text("#!/bin/bash\nset -euo pipefail\n/usr/bin/open -gj -a OrbStack\nexec "
                    + shlex.join(command) + "\n")
launcher.chmod(0o700)
data = {"Label": "dev.vibeshape.actions-fallback",
        "ProgramArguments": ["/bin/bash", str(launcher)],
        "RunAtLoad": True, "StartInterval": 180,
        "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
        "StandardOutPath": str(pathlib.Path(runtime) / "fallback.log"),
        "StandardErrorPath": str(pathlib.Path(runtime) / "fallback-error.log")}
pathlib.Path(agent).write_bytes(plistlib.dumps(data))
PY
launchctl bootout "gui/$(id -u)/$service" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$agent"
printf 'Installed %s for %s.\n' "$runner" "$repository"
