#!/bin/bash
set -euo pipefail

# Keep publication jobs independent of the checkout/dependencies left by earlier jobs.
workspace=/home/runner/_work/VibeShape/VibeShape
if [[ "${GITHUB_WORKSPACE:-}" != "$workspace" || "$(realpath -e "$workspace")" != "$workspace" ]]; then
    echo 'Refusing to clean an unexpected or symlinked runner workspace.' >&2
    exit 1
fi
find "$workspace" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
