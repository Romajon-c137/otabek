#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "update-production.sh must be run as root" >&2
  exit 1
fi

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
repo_root=$(git -C "${project_root}" rev-parse --show-toplevel)

exec 9>/run/lock/otabek-1c-deploy.lock
flock -n 9 || { echo "Another Otabek deploy is already running" >&2; exit 1; }

if [[ -n $(git -C "${repo_root}" status --porcelain) ]]; then
  echo "Refusing pull: the server checkout has local changes" >&2
  git -C "${repo_root}" status --short >&2
  exit 1
fi

current_branch=$(git -C "${repo_root}" branch --show-current)
if [[ ${current_branch} != main ]]; then
  echo "Refusing deploy from branch '${current_branch}'; expected 'main'" >&2
  exit 1
fi

git -C "${repo_root}" fetch origin main
git -C "${repo_root}" merge --ff-only origin/main

local_head=$(git -C "${repo_root}" rev-parse HEAD)
remote_head=$(git -C "${repo_root}" rev-parse origin/main)
if [[ ${local_head} != "${remote_head}" ]]; then
  echo "Refusing deploy: local main does not exactly match origin/main" >&2
  exit 1
fi

exec "${project_root}/tools/deploy-linux.sh"
