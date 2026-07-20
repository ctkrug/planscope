#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
site_root="$repo_root/site"
dist_root="$site_root/dist"

rm -rf "$dist_root"
mkdir -p "$dist_root"
cp "$site_root/index.html" "$site_root/style.css" "$dist_root/"
